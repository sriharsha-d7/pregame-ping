// Simulated league: fictional teams, a schedule anchored to when the server started, and a game
// that plays out deterministically as the (possibly fast-forwarded) clock advances.
// Fictional on purpose: safe to show in a demo video, and it always has a game about to start.
import { baseMs, nowMs, fmtWhen } from '../clock.js';

export const DEMO_TEAMS = {
  HAR: { name: 'Harbor Gulls', abbr: 'HAR', venue: 'Gull Point Arena', city: 'Port City' },
  RDG: { name: 'Ridge Foxes', abbr: 'RDG', venue: 'Foxhollow Center', city: 'Ridgefield' },
  DEL: { name: 'Delta Herons', abbr: 'DEL', venue: 'Heron Bay Dome', city: 'Delta Springs' },
  SUM: { name: 'Summit Owls', abbr: 'SUM', venue: 'Owl Peak Garden', city: 'Summitville' },
  MIL: { name: 'Millstone Bears', abbr: 'MIL', venue: 'Millstone Hall', city: 'Millstone' },
  LKS: { name: 'Lakeside Otters', abbr: 'LKS', venue: 'Otter Lake Forum', city: 'Lakeside' },
};

const GAME_MINUTES = 120; // wall-clock length of a game
const PERIODS = 4;
const PERIOD_MINUTES = GAME_MINUTES / PERIODS;

// [away, home, start offset in minutes from the anchor]
const SCHEDULE = [
  ['HAR', 'MIL', -26 * 60], // a finished game, for "what was the score?"
  ['RDG', 'HAR', 90],
  ['SUM', 'DEL', 150],
  ['MIL', 'LKS', 26 * 60],
  ['HAR', 'DEL', 27 * 60],
  ['LKS', 'RDG', 50 * 60],
  ['DEL', 'MIL', 74 * 60],
  ['SUM', 'HAR', 76 * 60],
  ['RDG', 'SUM', 98 * 60],
  ['HAR', 'LKS', 122 * 60],
];

const ANCHOR = Math.floor(baseMs() / 1800000) * 1800000; // half-hour boundary

function hash(a, b, c) {
  let x = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647)) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  x = Math.imul(x, 1274126177) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** Points a side has scored after `minutes` of game time. Monotonic and deterministic. */
function pointsAfter(gameId, side, minutes) {
  let pts = 0;
  const upTo = Math.min(GAME_MINUTES, Math.max(0, Math.floor(minutes)));
  for (let m = 0; m < upTo; m++) {
    const r = hash(gameId, m, side + 1) % 100;
    if (r < 45) pts += r % 7 === 0 ? 3 : 2;
  }
  return pts;
}

function clockText(elapsedInPeriod) {
  const secs = Math.max(0, Math.round(PERIOD_MINUTES === 0 ? 0 : 720 * (1 - elapsedInPeriod / PERIOD_MINUTES)));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

function buildGame([awayAbbr, homeAbbr, offsetMin], index, at) {
  const id = 9001 + index;
  const startMs = ANCHOR + offsetMin * 60000;
  const elapsed = (at - startMs) / 60000;
  const home = DEMO_TEAMS[homeAbbr];
  const away = DEMO_TEAMS[awayAbbr];
  let state = 'pre';
  let period = 0;
  let clock = '';
  let detail = fmtWhen(startMs, at);
  if (elapsed >= GAME_MINUTES) {
    state = 'post';
    period = PERIODS;
    clock = '0:00';
    detail = 'Final';
  } else if (elapsed >= 0) {
    state = 'in';
    period = Math.floor(elapsed / PERIOD_MINUTES) + 1;
    clock = clockText(elapsed - (period - 1) * PERIOD_MINUTES);
    detail = `Q${period} ${clock}`;
  }
  const shown = state === 'pre' ? 0 : elapsed;
  return {
    id: String(id),
    league: 'demo',
    leagueName: 'Demo League',
    startMs,
    start: new Date(startMs).toISOString(),
    state,
    period,
    periods: PERIODS,
    periodLabel: 'Q',
    clock,
    detail,
    home: { name: home.name, abbr: home.abbr, score: pointsAfter(id, 0, shown) },
    away: { name: away.name, abbr: away.abbr, score: pointsAfter(id, 1, shown) },
    venue: { name: home.venue, city: home.city, state: '' },
  };
}

export function createDemoProvider() {
  return {
    name: 'demo',
    label: 'Demo league (simulated games)',
    leagues: () => [{ key: 'demo', name: 'Demo League' }],
    async gamesBetween(fromMs, toMs) {
      const at = nowMs();
      return SCHEDULE.map((g, i) => buildGame(g, i, at))
        .filter((g) => g.startMs >= fromMs && g.startMs <= toMs)
        .sort((a, b) => a.startMs - b.startMs);
    },
  };
}
