// Simulated Alexa+ experience for Pregame Ping.
// Turns what a person says into MCP tool calls (over Streamable HTTP, with the official MCP client),
// polls the server for due reminders and updates, and lets a demo fast-forward the game clock.
//
// The "brain" is a deterministic phrase router so the demo works offline with no API keys.
// Swap route() for an LLM given the MCP tool list to get open-ended conversation.
import { isMain } from './ismain.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startMcp } from './server.js';
import * as clock from './clock.js';
import { resetFollows } from './follows.js';
import { getProvider } from './providers/index.js';
import { DEMO_TEAMS } from './providers/demo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const SIM_PORT = Number(process.env.SIM_PORT || 8080);
const MCP_PORT = Number(process.env.MCP_PORT || 3000);
const MCP_URL = process.env.MCP_URL || `http://localhost:${MCP_PORT}/mcp`;
const LOCAL = !process.env.MCP_URL; // clock controls and reset only work when the server runs in this process

// ---------------- MCP client ----------------

let clientPromise = null;
function mcp() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const c = new Client({ name: 'alexa-plus-simulator', version: '0.1.0' });
      await c.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
      return c;
    })();
    clientPromise.catch(() => (clientPromise = null));
  }
  return clientPromise;
}

async function callTool(name, args = {}) {
  const c = await mcp();
  const r = await c.callTool({ name, arguments: args });
  return { text: r.content?.[0]?.text ?? '', isError: !!r.isError, data: r.structuredContent };
}

// ---------------- language understanding ----------------

const HELP =
  'Try: "When do the Harbor Gulls play?", "Follow the Gulls", "Remind me a day and an hour before", "Update me at the end of every quarter", "What\'s the score?", or "What games are on tonight?"';

const session = { lastTeam: null };
export const resetSession = () => (session.lastTeam = null);

const WEEKDAY = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/;

const clean = (s) =>
  s
    .replace(/\b(the|team|please|game|games|match|score|status|again|now)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function demoTeamIn(t) {
  for (const team of Object.values(DEMO_TEAMS)) {
    const full = team.name.toLowerCase();
    const nick = full.split(' ').slice(-1)[0];
    if (t.includes(full) || new RegExp(`\\b${nick}\\b`).test(t) || new RegExp(`\\b${team.abbr.toLowerCase()}\\b`).test(t)) return team.name;
  }
  return null;
}

const TEAM_PATTERNS = [
  /\b(?:unfollow|stop following|stop tracking|follow|track)\s+(?:the\s+)?([a-z0-9 .'-]+?)(?=\s+(?:and|with|so|every|each|before|at|for|please)\b|$)/,
  /\b(?:when|where|what time)\s+(?:do|does|is|are|will|did)\s+(?:the\s+)?([a-z0-9 .'-]+?)\s+(?:play|playing|next|game)\b/,
  /\bhow\s+(?:are|is|did|do)\s+(?:the\s+)?([a-z0-9 .'-]+?)\s+(?:doing|do|play|playing|fare)\b/,
  /\b(?:score|result|status|update|news)\s+(?:of|for|on)\s+(?:the\s+)?([a-z0-9 .'-]+?)(?=\s+(?:game|please)\b|$)/,
  /\bwho\s+(?:won|is winning|is leading)\s+(?:the\s+)?([a-z0-9 .'-]+?)(?=\s+game\b|$)/,
  /\b(?:the\s+)?([a-z0-9 .'-]+?)\s+(?:game|score|schedule)\b/,
];

function extractTeam(t, isDemo) {
  if (isDemo) {
    const d = demoTeamIn(t);
    if (d) return d;
  }
  for (const re of TEAM_PATTERNS) {
    const m = t.match(re);
    if (m) {
      const team = clean(m[1]);
      if (team && !/^(me|it|them|that|this|my|what|any|some|games?|next|when|where)$/.test(team)) return team;
    }
  }
  return null;
}

const UNIT = { day: 1440, days: 1440, hour: 60, hours: 60, hr: 60, hrs: 60, minute: 1, minutes: 1, min: 1, mins: 1 };

/** Lead times mentioned in an utterance, in minutes: "a day and an hour before", "15 minutes before". */
export function parseLeads(t) {
  const leads = [];
  let rest = t;
  if (/\bhalf (an )?hour\b/.test(rest)) {
    leads.push(30);
    rest = rest.replace(/\bhalf (an )?hour\b/g, ' '); // so "half an hour" is not also read as "an hour"
  }
  const re = /\b(\d+|an?|one|two|three)\s*(days?|hours?|hrs?|minutes?|mins?)\b/g;
  let m;
  while ((m = re.exec(rest))) {
    const n = { a: 1, an: 1, one: 1, two: 2, three: 3 }[m[1]] ?? Number(m[1]);
    leads.push(n * UNIT[m[2]]);
  }
  return leads;
}

export function parsePrefs(t) {
  const prefs = {};
  const every = t.match(/\bevery (\d+)\s*(minutes?|mins?|hours?)\b/);
  if (every) {
    const n = Number(every[1]) * (/hour/.test(every[2]) ? 60 : 1);
    prefs.update_mode = 'interval';
    prefs.update_every_minutes = Math.min(120, Math.max(5, n));
  } else if (/\b(every|each|end of (each|every)?)\s*(quarter|period|half|inning)/.test(t)) prefs.update_mode = 'period';
  else if (/\b(every time|each time|whenever)\b.*\b(scor|score changes)|\bevery score\b|\beach score\b/.test(t)) prefs.update_mode = 'score';
  else if (/\b(no updates|don'?t update|no score updates)\b/.test(t)) prefs.update_mode = 'none';
  else if (/\bfinal (score )?only\b|\bjust the final\b|\bonly the final\b|\bwhen (it|the game) ends\b/.test(t)) prefs.update_mode = 'final';

  if (/\bno reminders\b|\bdon'?t remind\b/.test(t)) prefs.remind_minutes_before = [];
  else if (/\b(remind|alert|ping|notify|heads up|warn)\b/.test(t)) {
    // numbers that belong to an "every N minutes" update rhythm are not reminder lead times
    const tt = t.replace(/\bevery \d+\s*(minutes?|mins?|hours?)\b/g, ' ');
    const leads = parseLeads(tt);
    if (leads.length) prefs.remind_minutes_before = [...new Set(leads)].slice(0, 5);
  }
  return prefs;
}

/** Turn an utterance into { tool, args } or { say } (a spoken reply with no tool call). */
export function route(text, { demo = getProvider().name === 'demo' } = {}) {
  const t = text.toLowerCase().replace(/[?!,;]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return { say: HELP };

  const found = extractTeam(t, demo);
  if (found) session.lastTeam = found;
  const team = found ?? session.lastTeam;
  const leagueMatch = t.match(/\b(nba|nfl|nhl|mlb|wnba|mls|epl|ncaaf|ncaamb)\b/);
  const league = leagueMatch ? leagueMatch[1] : undefined;
  const lg = league ? { league } : {};

  if (/\b(what|which)\b.*\b(following|follow)\b|\bmy teams\b|\bmy follows\b/.test(t)) return { tool: 'list_follows', args: {} };

  if (/\b(unfollow|stop following|stop tracking|stop reminding)\b/.test(t)) {
    if (!found) return { say: 'Which team should I stop following?' };
    return { tool: 'unfollow_team', args: { team: found } };
  }

  const prefs = parsePrefs(t);
  const wantsFollow = /\b(follow|track|keep me posted)\b/.test(t) || Object.keys(prefs).length > 0;
  if (wantsFollow) {
    if (!team) return { say: 'Which team? For example: "Follow the Harbor Gulls".' };
    return { tool: 'follow_team', args: { team, ...lg, ...prefs } };
  }

  const dayWord = t.match(/\b(today|tonight|tomorrow)\b/)?.[1] ?? t.match(WEEKDAY)?.[1];
  if (!found && /\b(games?|matches|who'?s playing|who is playing|what'?s on|what is on|schedule)\b/.test(t) && (dayWord || /\bon\b/.test(t))) {
    return { tool: 'find_games', args: { day: dayWord || 'today', ...lg } };
  }

  if (/\b(score|status|how are|how is|how did|result|winning|losing|who won|any update|update on|updates? on)\b|\bhow'?s\b/.test(t) || /\b(update|news)\b/.test(t)) {
    if (!team) return { say: 'Which team?' };
    return { tool: 'game_status', args: { team, ...lg } };
  }

  if (/\b(schedule|upcoming|games)\b/.test(t) && team) return { tool: 'find_games', args: { team, ...lg } };

  if (/\b(when|where|what time|next game|play|plays|playing)\b/.test(t)) {
    if (!team) return { say: 'Which team?' };
    return { tool: 'next_game', args: { team, ...lg } };
  }

  if (team && found) return { tool: 'next_game', args: { team, ...lg } };
  return { say: HELP };
}

// ---------------- state for the page ----------------

async function snapshot() {
  const provider = getProvider();
  const [today, tomorrow, follows] = await Promise.all([
    callTool('find_games', { day: 'today', limit: 8 }),
    callTool('find_games', { day: 'tomorrow', limit: 8 }),
    callTool('list_follows'),
  ]);
  const now = clock.nowMs();
  return {
    provider: provider.name,
    providerLabel: provider.label,
    nowLabel: new Date(now).toLocaleString('en-US', { timeZone: clock.tz(), weekday: 'short', hour: 'numeric', minute: '2-digit' }),
    offsetMinutes: clock.offsetMinutes(),
    canAdvance: LOCAL,
    games: { today: today.data?.games ?? [], tomorrow: tomorrow.data?.games ?? [] },
    gamesError: today.isError ? today.text : tomorrow.isError ? tomorrow.text : null,
    follows: (follows.data?.follows ?? []).map((f) => ({
      id: f.id,
      team: f.team.name,
      reminders: f.reminders,
      update: f.update,
      words: follows.text.split('\n').find((l) => l.includes(f.team.name))?.replace(/^- /, '') ?? '',
    })),
  };
}

// ---------------- HTTP ----------------

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const sendJson = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};

export async function startSim() {
  if (LOCAL) await startMcp(MCP_PORT);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (req.method === 'POST' && url.pathname === '/api/chat') {
        const { text } = await readBody(req);
        const plan = route(String(text || ''));
        if (!plan.tool) return sendJson(res, 200, { reply: plan.say, trace: null });
        const result = await callTool(plan.tool, plan.args);
        return sendJson(res, 200, {
          reply: result.text,
          trace: { tool: plan.tool, args: plan.args, isError: result.isError, data: result.data ?? null },
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/state') return sendJson(res, 200, await snapshot());

      // the page polls this; Alexa+ would do the same with the check_notifications tool
      if (req.method === 'GET' && url.pathname === '/api/notifications') {
        const r = await callTool('check_notifications');
        return sendJson(res, 200, { notifications: r.data?.notifications ?? [], errors: r.data?.errors ?? [], now: clock.nowMs() });
      }

      if (req.method === 'POST' && url.pathname === '/api/advance') {
        if (!LOCAL) return sendJson(res, 400, { error: 'The clock can only be fast-forwarded when the server runs with the simulator.' });
        const { minutes, toNextGame, leadMinutes } = await readBody(req);
        let mins = Number(minutes) || 0;
        if (toNextGame) {
          const now = clock.nowMs();
          const next = (await getProvider().gamesBetween(now, now + 3 * 86400000)).find((g) => g.state === 'pre');
          if (!next) return sendJson(res, 200, { moved: 0, note: 'No upcoming game in the next three days.' });
          mins = Math.max(0, Math.round((next.startMs - (leadMinutes ?? 10) * 60000 - now) / 60000));
        }
        if (getProvider().name !== 'demo') return sendJson(res, 400, { error: 'Fast-forward only applies to the simulated league.' });
        clock.advance(mins);
        return sendJson(res, 200, { moved: mins });
      }

      if (req.method === 'POST' && url.pathname === '/api/reset' && LOCAL) {
        clock.resetClock();
        resetFollows();
        resetSession();
        return sendJson(res, 200, { ok: true });
      }

      let file = url.pathname === '/' ? '/index.html' : url.pathname;
      const full = path.normalize(path.join(PUBLIC, file));
      if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
    } catch (err) {
      console.error(err);
      sendJson(res, 500, { error: String(err.message || err) });
    }
  });
  await new Promise((r) => server.listen(SIM_PORT, r));
  console.log(`Alexa+ simulator on http://localhost:${SIM_PORT}  (MCP: ${MCP_URL}, data: ${getProvider().label})`);
  return server;
}

if (isMain(import.meta.url)) startSim();
