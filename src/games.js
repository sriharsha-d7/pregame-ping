// Team matching and the spoken wording for games.
import { nowMs, fmtWhen, fmtUntil } from './clock.js';
import { getProvider } from './providers/index.js';

export const HOUR = 3600000;
export const DAY = 24 * HOUR;

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|fc|team)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function sideMatches(side, q) {
  if (!q) return false;
  const name = norm(side.name);
  const nick = norm(side.nick);
  if (side.abbr && side.abbr.toLowerCase() === q) return true;
  if (name === q) return true;
  if (q.length >= 3 && name.includes(q)) return true;
  if (nick && (nick === q || (nick.length >= 3 && q.includes(nick)))) return true;
  return false;
}

export const teamId = (game, side) => `${game.league}:${side.abbr}`;

function teamOf(game, side) {
  return { name: side.name, abbr: side.abbr, league: game.league, leagueName: game.leagueName };
}

/** Find which team a spoken name means, from the games in a window. */
export async function lookupTeam(query, { league, fromMs = nowMs() - 2 * DAY, toMs = nowMs() + 14 * DAY } = {}) {
  const q = norm(query);
  if (!q) return { error: 'Which team?' };
  const games = await getProvider().gamesBetween(fromMs, toMs, { league });
  const matched = new Map();
  for (const g of games) {
    for (const side of [g.home, g.away]) {
      if (sideMatches(side, q)) matched.set(teamId(g, side), teamOf(g, side));
    }
  }
  if (matched.size === 0) {
    const where = league ? ` in ${league}` : '';
    return { error: `I couldn't find a team called "${query}" playing in the next two weeks${where}. If it's offseason or in a league I don't search by default, tell me the league.` };
  }
  if (matched.size > 1) {
    const options = [...matched.values()].map((t) => `${t.name} (${t.leagueName})`);
    return { error: `"${query}" could mean ${options.join(' or ')}. Which one?`, ambiguous: [...matched.values()] };
  }
  const team = [...matched.values()][0];
  return { team, games: games.filter((g) => teamId(g, g.home) === `${team.league}:${team.abbr}` || teamId(g, g.away) === `${team.league}:${team.abbr}`) };
}

/** A resolved team's games in a window. */
export async function teamGames(team, fromMs, toMs) {
  const games = await getProvider().gamesBetween(fromMs, toMs, { league: team.league === 'demo' ? undefined : team.league });
  return games.filter((g) => g.league === team.league && (g.home.abbr === team.abbr || g.away.abbr === team.abbr));
}

// ---------- wording ----------

export const venueText = (g) =>
  g.venue?.name ? `${g.venue.name}${g.venue.city ? ' in ' + g.venue.city : ''}` : 'a venue that has not been announced';

export const matchup = (g) => `${g.away.name} at ${g.home.name}`;

export function liveText(g) {
  if (!g.clock && g.state === 'in' && g.detail) return g.detail; // e.g. baseball: "Top 7th"
  const label = g.periodLabel || 'P';
  const period = g.period ? `${label}${g.period}` : '';
  return [period, g.clock].filter(Boolean).join(' ');
}

/** "Harbor Gulls 54, Ridge Foxes 49" with the followed team first when known. */
export function scoreLine(g, abbr) {
  const [a, b] = abbr && g.away.abbr === abbr ? [g.away, g.home] : [g.home, g.away];
  const first = abbr ? [a, b] : [g.away, g.home];
  return `${first[0].name} ${first[0].score}, ${first[1].name} ${first[1].score}`;
}

export function resultText(g) {
  if (g.home.score === g.away.score) return 'It ended in a tie.';
  const w = g.home.score > g.away.score ? g.home : g.away;
  return `${w.name} win.`;
}

export function describeGame(g, ref = nowMs()) {
  if (g.state === 'in') return `${matchup(g)} is live. ${scoreLine(g)} (${liveText(g)}).`;
  if (g.state === 'post') return `Final: ${scoreLine(g)}. ${resultText(g)}`;
  return `${matchup(g)}, ${fmtWhen(g.startMs, ref)}, at ${venueText(g)}.`;
}

export function reminderText(g, at = nowMs()) {
  const mins = Math.round((g.startMs - at) / 60000);
  const when = mins < 12 * 60 ? `${fmtUntil(g.startMs, at)}` : fmtWhen(g.startMs, at);
  const lead = mins < 12 * 60 ? `starts ${when}` : `is ${when}`;
  return `Heads up: ${matchup(g)} ${lead}, at ${venueText(g)}.`;
}

export function updateText(g, abbr, label = 'Update') {
  return `${label}: ${scoreLine(g, abbr)}, ${liveText(g)}.`;
}

export function finalText(g, abbr) {
  return `Final: ${scoreLine(g, abbr)}. ${resultText(g)}`;
}
