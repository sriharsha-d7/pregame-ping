// End-to-end: real MCP client -> Streamable HTTP -> Pregame Ping, fast-forwarding the demo clock
// through a whole game to check reminders, period/score/interval updates and finals.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PING_DB = path.join(os.tmpdir(), `ping-test-${process.pid}.json`);
process.env.DEMO_NOW = '2026-10-21T16:10:00Z'; // 12:10 PM in New York
process.env.USER_TZ = 'America/New_York';

const clock = await import('../src/clock.js');
const { startMcp } = await import('../src/server.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

const httpServer = await startMcp(3921);
const client = new Client({ name: 'e2e', version: '0.0.1' });
await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3921/mcp')));

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content[0].text, isError: !!r.isError, data: r.structuredContent };
};
const advanceTo = (iso) => clock.advance((Date.parse(iso) - clock.nowMs()) / 60000);
const notes = async () => (await call('check_notifications')).data.notifications;

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(tools, ['check_notifications', 'find_games', 'follow_team', 'game_status', 'list_follows', 'next_game', 'unfollow_team']);

// ---- when and where ----
let r = await call('find_games', { team: 'Gulls' });
assert.ok(!r.isError, r.text);
assert.match(r.text, /Ridge Foxes at Harbor Gulls, today at 1:30 PM, at Gull Point Arena in Port City/);

r = await call('next_game', { team: 'HAR' });
assert.match(r.text, /Gull Point Arena/);

r = await call('find_games', { day: 'today' });
assert.equal(r.data.games.length, 2, r.text);

r = await call('find_games', { team: 'Zebras' });
assert.ok(r.isError);
assert.match(r.text, /couldn't find a team/);

r = await call('game_status', { team: 'Gulls' });
assert.match(r.text, /Last game: Final: .*Millstone Bears/);
assert.match(r.text, /Next: Ridge Foxes at Harbor Gulls/);

// ---- follow, with different settings per team ----
r = await call('follow_team', { team: 'Gulls', remind_minutes_before: [60, 15], update_mode: 'period' });
assert.ok(!r.isError, r.text);
assert.match(r.text, /1 hour, 15 minutes before games/);
assert.match(r.text, /end of each period/);

r = await call('follow_team', { team: 'Otters', remind_minutes_before: [1440, 60, 15], update_mode: 'final' });
assert.ok(!r.isError, r.text);

assert.equal((await notes()).length, 0, 'nothing is due yet');

// ---- reminders ----
advanceTo('2026-10-21T16:50:00Z'); // 40 minutes before tip-off; the 1 hour reminder is due
let n = await notes();
assert.equal(n.length, 1, JSON.stringify(n));
assert.match(n[0].text, /Heads up: Ridge Foxes at Harbor Gulls starts in 40 minutes, at Gull Point Arena in Port City/);
assert.equal((await notes()).length, 0, 'a reminder is delivered once');

advanceTo('2026-10-21T17:20:00Z'); // 10 minutes before; the 15 minute reminder is due
n = await notes();
assert.equal(n.length, 1);
assert.match(n[0].text, /starts in 10 minutes/);

// ---- live: end of period ----
advanceTo('2026-10-21T17:40:00Z'); // 10 minutes in, first sighting is silent
assert.equal((await notes()).length, 0);

advanceTo('2026-10-21T18:05:00Z'); // 35 minutes in: Q2
n = await notes();
const otters = n.filter((x) => x.team === 'Lakeside Otters');
assert.equal(otters.length, 1, JSON.stringify(n)); // the one-day-ahead reminder for their game tomorrow
assert.match(otters[0].text, /is tomorrow at 2:00 PM, at Otter Lake Forum/);
n = n.filter((x) => x.team === 'Harbor Gulls');
assert.equal(n.length, 1, JSON.stringify(n));
assert.match(n[0].text, /^End of Q1: Harbor Gulls \d+, Ridge Foxes \d+, Q2 /);

r = await call('game_status', { team: 'Foxes' });
assert.match(r.text, /is live\. .*\(Q2 /);

// ---- change settings: every score change ----
r = await call('follow_team', { team: 'Gulls', update_mode: 'score' });
assert.match(r.text, /every time the score changes/);
assert.match(r.text, /1 hour, 15 minutes before games/, 'reminder settings are kept when only updates change');

advanceTo('2026-10-21T18:10:00Z');
n = await notes();
assert.ok(n.some((x) => /^Score: Harbor Gulls \d+, Ridge Foxes \d+/.test(x.text)), JSON.stringify(n));

// ---- interval updates for a different team ----
r = await call('follow_team', { team: 'Owls', update_mode: 'interval', update_every_minutes: 10 });
assert.match(r.text, /every 10 minutes/);

advanceTo('2026-10-21T18:20:00Z'); // Owls tip off at 2:30 PM ET, 10 minutes away
n = (await notes()).filter((x) => x.team === 'Summit Owls');
assert.equal(n.length, 1);
assert.match(n[0].text, /Summit Owls at Delta Herons starts in 10 minutes/);

advanceTo('2026-10-21T18:35:00Z'); // 5 minutes in, silent
assert.equal((await notes()).filter((x) => x.team === 'Summit Owls').length, 0);

advanceTo('2026-10-21T18:47:00Z'); // 12 minutes after the last check: interval update
n = (await notes()).filter((x) => x.team === 'Summit Owls');
assert.equal(n.length, 1);
assert.match(n[0].text, /^Update: Summit Owls \d+, Delta Herons \d+, Q1 /);

// ---- finals ----
advanceTo('2026-10-21T19:37:00Z'); // Gulls game ended at 19:30
n = (await notes()).filter((x) => x.kind === 'final');
assert.equal(n.length, 1, JSON.stringify(n));
assert.match(n[0].text, /^Final: Harbor Gulls \d+, Ridge Foxes \d+\. .* win\.$/);

// ---- several reminders come due at once: only the closest is spoken ----
advanceTo('2026-10-22T17:50:00Z'); // 10 minutes before the Otters' next game
n = (await notes()).filter((x) => x.team === 'Lakeside Otters');
assert.equal(n.length, 1, JSON.stringify(n));
assert.equal(n[0].kind, 'reminder');
assert.match(n[0].text, /starts in 10 minutes/);

// ---- managing follows ----
r = await call('list_follows');
assert.match(r.text, /Harbor Gulls/);
assert.match(r.text, /Lakeside Otters/);

r = await call('unfollow_team', { team: 'Gulls' });
assert.ok(!r.isError);
r = await call('unfollow_team', { team: 'Gulls' });
assert.ok(r.isError);

await client.close();
httpServer.close();
fs.rmSync(process.env.PING_DB, { force: true });
console.log('e2e passed');
