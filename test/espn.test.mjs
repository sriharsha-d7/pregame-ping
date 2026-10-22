// The live provider, tested against a fake feed shaped like ESPN's scoreboard response.
// (This checks our parsing and error handling; it does not call the real ESPN service.)
import assert from 'node:assert/strict';

process.env.DEMO_NOW = '2026-10-20T15:00:00Z';
process.env.USER_TZ = 'America/New_York';

const { normalizeEvent, createEspnProvider } = await import('../src/providers/espn.js');
const { setProvider } = await import('../src/providers/index.js');
const { lookupTeam, describeGame } = await import('../src/games.js');

const event = (id, date, state, home, away, venue, extra = {}) => ({
  id,
  date,
  status: { clock: 0, period: 0, type: { state, detail: 'x' }, ...extra },
  competitions: [
    {
      venue: { fullName: venue[0], address: { city: venue[1], state: venue[2] } },
      competitors: [
        { homeAway: 'home', score: String(home[3] ?? 0), team: { name: home[0], abbreviation: home[1], displayName: home[2] } },
        { homeAway: 'away', score: String(away[3] ?? 0), team: { name: away[0], abbreviation: away[1], displayName: away[2] } },
      ],
    },
  ],
});

const PISTONS = ['Pistons', 'DET', 'Detroit Pistons'];
const CELTICS = ['Celtics', 'BOS', 'Boston Celtics'];
const NY_GIANTS = ['Giants', 'NYG', 'New York Giants'];
const SF_GIANTS = ['Giants', 'SF', 'San Francisco Giants'];
const EAGLES = ['Eagles', 'PHI', 'Philadelphia Eagles'];
const DODGERS = ['Dodgers', 'LAD', 'Los Angeles Dodgers'];

const feeds = {
  '/basketball/nba/': [event('1', '2026-10-20T19:00Z', 'pre', PISTONS, CELTICS, ['Little Caesars Arena', 'Detroit', 'MI'])],
  '/football/nfl/': [event('2', '2026-10-22T00:20Z', 'pre', NY_GIANTS, EAGLES, ['MetLife Stadium', 'East Rutherford', 'NJ'])],
  '/baseball/mlb/': [event('3', '2026-10-21T23:00Z', 'in', SF_GIANTS.concat([3]), DODGERS.concat([5]), ['Oracle Park', 'San Francisco', 'CA'], { period: 7, displayClock: '', type: { state: 'in', detail: 'Top 7th', shortDetail: 'Top 7th' } })],
};

const calls = [];
const fakeFetch = async (url) => {
  calls.push(url);
  const key = Object.keys(feeds).find((k) => url.includes(k));
  return { ok: true, status: 200, json: async () => ({ events: feeds[key] || [] }) };
};

// ---- parsing ----
const g = normalizeEvent(feeds['/basketball/nba/'][0], 'nba');
assert.equal(g.home.name, 'Detroit Pistons');
assert.equal(g.away.abbr, 'BOS');
assert.equal(g.state, 'pre');
assert.equal(g.startMs, Date.parse('2026-10-20T19:00Z'));
assert.deepEqual(g.venue, { name: 'Little Caesars Arena', city: 'Detroit', state: 'MI' });
assert.equal(normalizeEvent({ id: '9', date: 'nonsense', competitions: [] }, 'nba'), null, 'bad events are skipped, not thrown');

// ---- lookup over the provider ----
setProvider(createEspnProvider({ fetchImpl: fakeFetch, leagues: ['nba', 'nfl', 'mlb'] }));

let r = await lookupTeam('Pistons');
assert.ok(!r.error, r.error);
assert.equal(r.team.abbr, 'DET');
assert.equal(r.team.league, 'nba');
assert.equal(r.games.length, 1, 'the same game fetched for several days is counted once');
assert.match(describeGame(r.games[0]), /Boston Celtics at Detroit Pistons, today at 3:00 PM, at Little Caesars Arena in Detroit\./);
assert.ok(calls.some((u) => u.includes('/basketball/nba/scoreboard?dates=')), calls[0]);

r = await lookupTeam('Giants');
assert.ok(r.error && r.ambiguous?.length === 2, 'Giants is in two leagues');
assert.match(r.error, /New York Giants \(NFL\) or San Francisco Giants \(MLB\)|San Francisco Giants \(MLB\) or New York Giants \(NFL\)/);

r = await lookupTeam('Giants', { league: 'mlb' });
assert.ok(!r.error, r.error);
assert.equal(r.team.abbr, 'SF');
assert.match(describeGame(r.games[0]), /^Los Angeles Dodgers at San Francisco Giants is live\. Los Angeles Dodgers 5, San Francisco Giants 3 \(Top 7th\)\.$/);

await assert.rejects(() => lookupTeam('Giants', { league: 'curling' }), /Unknown league "curling"\. Try one of: nba/);

// ---- feed outage ----
setProvider(createEspnProvider({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }), leagues: ['nba'] }));
await assert.rejects(() => lookupTeam('Pistons'), /Couldn't reach the sports feed/);

console.log('espn tests passed');
