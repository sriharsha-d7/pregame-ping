// Followed teams, reminder lead times, update rhythms, and the engine that decides what to announce.
//
// MCP is request/response, so the server cannot push on its own. Instead it keeps an outbox:
// collectDue() decides what is due right now and check_notifications hands those messages to
// whatever is listening (the simulator polls; a deployment could poll from a scheduled routine).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowMs } from './clock.js';
import { HOUR, DAY, teamGames, reminderText, updateText, finalText, teamId } from './games.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.PING_DB || path.join(here, '..', 'data', 'follows.json');

export const UPDATE_MODES = ['none', 'final', 'period', 'interval', 'score'];

const fresh = () => ({ nextFollow: 1, nextNote: 1, follows: [], sent: {}, progress: {}, outbox: [] });
let db = null;

function load() {
  if (db) return db;
  try {
    db = { ...fresh(), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch {
    db = fresh();
  }
  return db;
}

function save() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

export function resetFollows() {
  db = fresh();
  save();
}

export const listFollows = () => load().follows;

export function describeFollow(f) {
  const r = f.reminders.length ? f.reminders.map(leadWords).join(', ') + ' before games' : 'no game reminders';
  const u = {
    none: 'no score updates',
    final: 'the final score only',
    period: 'a score update at the end of each period',
    score: 'an update every time the score changes',
    interval: `a score update every ${f.update.minutes} minutes during games`,
  }[f.update.mode];
  return `${f.team.name}: ${r}, ${u}.`;
}

function leadWords(minutes) {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minutes`;
}

/** Create or update the preferences for a team. Updating keeps what was already announced. */
export function upsertFollow({ team, reminders, update }) {
  const d = load();
  const id = teamId({ league: team.league }, team);
  let f = d.follows.find((x) => teamId({ league: x.team.league }, x.team) === id);
  if (!f) {
    f = { id: d.nextFollow++, team, reminders: [60, 15], update: { mode: 'final', minutes: 15 }, createdAtMs: nowMs() };
    d.follows.push(f);
  }
  if (reminders) f.reminders = [...new Set(reminders)].sort((a, b) => b - a);
  if (update) f.update = { ...f.update, ...update };
  save();
  return f;
}

export function removeFollow(teamName) {
  const d = load();
  const q = String(teamName).toLowerCase();
  const hit = d.follows.find((f) => f.team.name.toLowerCase().includes(q) || f.team.abbr.toLowerCase() === q);
  if (!hit) return null;
  d.follows = d.follows.filter((f) => f !== hit);
  save();
  return hit;
}

// ---------- the engine ----------

let chain = Promise.resolve();

/** Work out what is due at `at` and add it to the outbox. Calls are serialised. */
export function collectDue(at = nowMs()) {
  const run = chain.then(() => collect(at));
  chain = run.catch(() => {});
  return run;
}

function note(d, f, g, kind, text, at) {
  const n = { id: d.nextNote++, at: new Date(at).toISOString(), kind, team: f.team.name, gameId: g.id, text, delivered: false };
  d.outbox.push(n);
  return n;
}

async function collect(at) {
  const d = load();
  const created = [];
  const errors = [];

  for (const f of d.follows) {
    let games;
    try {
      games = await teamGames(f.team, at - 8 * HOUR, at + 8 * DAY);
    } catch (e) {
      errors.push(`${f.team.name}: ${e.message}`);
      continue;
    }

    for (const g of games) {
      const abbr = f.team.abbr;

      // 1) reminders before the game
      if (g.state === 'pre' && g.startMs > at) {
        const due = f.reminders.filter((lead) => at >= g.startMs - lead * 60000);
        const unsent = due.filter((lead) => !d.sent[`r|${f.id}|${g.id}|${lead}`]);
        due.forEach((lead) => (d.sent[`r|${f.id}|${g.id}|${lead}`] = true));
        // a reminder is only for moments the follow existed; and if several came due together, say only the closest
        const live = unsent.filter((lead) => g.startMs - lead * 60000 >= f.createdAtMs);
        if (live.length) created.push(note(d, f, g, 'reminder', reminderText(g, at), at));
      }

      // 2) updates while the game is on
      if (g.state === 'in') {
        const key = `${f.id}|${g.id}`;
        const score = `${g.home.score}-${g.away.score}`;
        const p = d.progress[key];
        if (!p) {
          d.progress[key] = { period: g.period, score, lastAt: at };
        } else {
          let send = false;
          let label = 'Update';
          if (f.update.mode === 'period' && g.period > p.period) {
            send = true;
            label = g.period === p.period + 1 ? `End of ${g.periodLabel || 'P'}${p.period}` : 'Update';
          } else if (f.update.mode === 'score' && score !== p.score) {
            send = true;
            label = 'Score';
          } else if (f.update.mode === 'interval' && at - p.lastAt >= f.update.minutes * 60000) {
            send = true;
          }
          if (send) {
            created.push(note(d, f, g, 'update', updateText(g, abbr, label), at));
            p.lastAt = at;
          }
          p.period = g.period;
          p.score = score;
        }
      }

      // 3) the final score
      if (g.state === 'post' && at - g.startMs < DAY) {
        const k = `f|${f.id}|${g.id}`;
        if (!d.sent[k]) {
          d.sent[k] = true;
          const seen = !!d.progress[`${f.id}|${g.id}`];
          if (f.update.mode !== 'none' && (seen || f.createdAtMs <= g.startMs + 3 * HOUR)) {
            created.push(note(d, f, g, 'final', finalText(g, abbr), at));
          }
        }
      }
    }
  }

  d.outbox = d.outbox.slice(-100);
  save();
  return { created, errors };
}

/** Hand over everything not yet delivered, and mark it delivered. */
export function takeOutbox() {
  const d = load();
  const out = d.outbox.filter((n) => !n.delivered);
  out.forEach((n) => (n.delivered = true));
  if (out.length) save();
  return out;
}

export const recentNotifications = (n = 10) => load().outbox.slice(-n);
