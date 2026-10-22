// Pregame Ping MCP server.
// Self-hosted, Streamable HTTP, stateless (a fresh McpServer per request), so it can be registered
// with Alexa+ as a remote MCP server at http(s)://<host>/mcp.
import { isMain } from './ismain.js';
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { nowMs, dayKey, addDaysToKey, fmtWhen } from './clock.js';
import { getProvider } from './providers/index.js';
import { DAY, lookupTeam, teamGames, describeGame, venueText } from './games.js';
import { UPDATE_MODES, upsertFollow, removeFollow, listFollows, describeFollow, collectDue, takeOutbox } from './follows.js';

const PORT = Number(process.env.MCP_PORT || 3000);
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const ok = (text, data) => ({ content: [{ type: 'text', text }], structuredContent: data });
const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });

const leagueArg = z.string().optional().describe('Optional league, e.g. nba, nfl, nhl, mlb, wnba, epl, mls. Leave out to search all.');

function resolveDay(input) {
  const t = String(input || 'today').toLowerCase().trim();
  const today = dayKey(nowMs());
  if (t === 'today' || t === 'tonight') return today;
  if (t === 'tomorrow') return addDaysToKey(today, 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const i = WEEKDAYS.findIndex((w) => t.startsWith(w.slice(0, 3)));
  if (i >= 0) {
    for (let n = 1; n <= 7; n++) {
      const key = addDaysToKey(today, n);
      if (new Date(key + 'T12:00:00Z').getUTCDay() === i) return key;
    }
  }
  return null;
}

const brief = (g) => ({
  id: g.id,
  league: g.leagueName,
  away: { name: g.away.name, abbr: g.away.abbr, score: g.away.score },
  home: { name: g.home.name, abbr: g.home.abbr, score: g.home.score },
  state: g.state,
  detail: g.state === 'pre' ? fmtWhen(g.startMs) : g.detail,
  startsAt: g.start,
  venue: venueText(g),
});

export function buildServer() {
  const server = new McpServer({ name: 'pregame-ping', version: '0.1.0' });

  server.registerTool(
    'find_games',
    {
      title: 'Find games',
      description:
        'Say when and where games are happening. Give a team to see its upcoming games, or give a day (today, tomorrow, a weekday, or YYYY-MM-DD) to see everything on that day.',
      inputSchema: {
        team: z.string().optional().describe('Team name, nickname or abbreviation, e.g. "Gulls" or "HAR"'),
        day: z.string().optional().describe('today, tomorrow, a weekday name, or YYYY-MM-DD. Used when no team is given.'),
        league: leagueArg,
        limit: z.number().int().min(1).max(15).optional(),
      },
    },
    async ({ team, day, league, limit }) => {
      try {
        if (team) {
          const r = await lookupTeam(team, { league });
          if (r.error) return fail(r.error);
          const now = nowMs();
          let games = r.games.filter((g) => g.state !== 'post').slice(0, limit ?? 5);
          if (!games.length) games = r.games.slice(-1);
          if (!games.length) return ok(`I don't see any games for the ${r.team.name} right now.`, { team: r.team, games: [] });
          return ok(games.map((g) => `- ${describeGame(g, now)}`).join('\n'), { team: r.team, games: games.map(brief) });
        }
        const key = resolveDay(day);
        if (!key) return fail(`I didn't understand the day "${day}". Try today, tomorrow, a weekday, or a date like 2026-10-24.`);
        const mid = Date.parse(key + 'T00:00:00Z');
        const all = await getProvider().gamesBetween(mid - 14 * 3600000, mid + 38 * 3600000, { league });
        const games = all.filter((g) => dayKey(g.startMs) === key).slice(0, limit ?? 12);
        if (!games.length) return ok(`No games found for ${key === dayKey(nowMs()) ? 'today' : key}.`, { games: [] });
        return ok(games.map((g) => `- ${describeGame(g)}`).join('\n'), { games: games.map(brief) });
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  server.registerTool(
    'next_game',
    {
      title: 'Next game for a team',
      description: 'When and where a team plays next. If the team is playing right now, gives the live score instead.',
      inputSchema: { team: z.string(), league: leagueArg },
    },
    async ({ team, league }) => {
      try {
        const r = await lookupTeam(team, { league });
        if (r.error) return fail(r.error);
        const g = r.games.find((x) => x.state === 'in') || r.games.find((x) => x.state === 'pre');
        if (!g) return ok(`I don't see another game scheduled for the ${r.team.name} in the next two weeks.`, { team: r.team, game: null });
        return ok(describeGame(g), { team: r.team, game: brief(g) });
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  server.registerTool(
    'game_status',
    {
      title: 'Score and status',
      description: 'The live score if a team is playing, otherwise its most recent result and next game.',
      inputSchema: { team: z.string(), league: leagueArg },
    },
    async ({ team, league }) => {
      try {
        const r = await lookupTeam(team, { league });
        if (r.error) return fail(r.error);
        const live = r.games.find((g) => g.state === 'in');
        if (live) return ok(describeGame(live), { team: r.team, game: brief(live) });
        const past = [...r.games].reverse().find((g) => g.state === 'post');
        const next = r.games.find((g) => g.state === 'pre');
        const parts = [];
        if (past) parts.push(`Last game: ${describeGame(past)}`);
        if (next) parts.push(`Next: ${describeGame(next)}`);
        if (!parts.length) return ok(`I don't have a recent or upcoming game for the ${r.team.name}.`, { team: r.team });
        return ok(parts.join(' '), { team: r.team, last: past ? brief(past) : null, next: next ? brief(next) : null });
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  server.registerTool(
    'follow_team',
    {
      title: 'Follow a team',
      description:
        'Follow a team and choose how to hear about it: how long before each game to be reminded (several lead times allowed), and how often to get score updates during games. Calling it again for the same team changes the settings.',
      inputSchema: {
        team: z.string(),
        league: leagueArg,
        remind_minutes_before: z
          .array(z.number().int().min(1).max(10080))
          .max(5)
          .optional()
          .describe('Lead times in minutes, e.g. [1440, 60, 15] for a day, an hour, and 15 minutes before. Empty array for no reminders.'),
        update_mode: z
          .enum(['none', 'final', 'period', 'interval', 'score'])
          .optional()
          .describe('none: no score updates. final: final score only. period: end of each quarter/half/period. interval: every N minutes. score: whenever the score changes.'),
        update_every_minutes: z.number().int().min(5).max(120).optional().describe('Only for interval mode. Default 15.'),
      },
    },
    async ({ team, league, remind_minutes_before, update_mode, update_every_minutes }) => {
      try {
        if (update_mode && !UPDATE_MODES.includes(update_mode)) return fail('Unknown update mode.');
        const r = await lookupTeam(team, { league });
        if (r.error) return fail(r.error);
        const update = {};
        if (update_mode) update.mode = update_mode;
        if (update_mode === 'interval' || update_every_minutes) update.minutes = update_every_minutes ?? 15;
        const f = upsertFollow({ team: r.team, reminders: remind_minutes_before, update: Object.keys(update).length ? update : undefined });
        const next = r.games.find((g) => g.state === 'in') || r.games.find((g) => g.state === 'pre');
        let text = `Following the ${r.team.name}. ${describeFollow(f)}`;
        if (next) text += ` Next: ${describeGame(next)}`;
        return ok(text, { follow: f, next: next ? brief(next) : null });
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  server.registerTool(
    'unfollow_team',
    { title: 'Stop following a team', description: 'Stop reminders and updates for a team.', inputSchema: { team: z.string() } },
    async ({ team }) => {
      const gone = removeFollow(team);
      if (!gone) return fail(`You're not following "${team}".`);
      return ok(`Okay, I've stopped following the ${gone.team.name}.`, { removed: gone });
    }
  );

  server.registerTool(
    'list_follows',
    { title: 'What am I following?', description: 'List followed teams with their reminder and update settings.', inputSchema: {} },
    async () => {
      const fs = listFollows();
      if (!fs.length) return ok("You're not following any teams yet. Tell me which one.", { follows: [] });
      return ok(fs.map((f) => `- ${describeFollow(f)}`).join('\n'), { follows: fs });
    }
  );

  server.registerTool(
    'check_notifications',
    {
      title: 'Check for reminders and updates',
      description:
        'Check whether any reminder or score update is due right now for the teams being followed, and return the messages to announce. Each message is returned once. Call this regularly.',
      inputSchema: {},
    },
    async () => {
      try {
        const { errors } = await collectDue();
        const out = takeOutbox();
        const data = { notifications: out, errors };
        if (!out.length) return ok(errors.length ? `Nothing new, but I couldn't check everything: ${errors.join('; ')}` : 'Nothing new.', data);
        return ok(out.map((n) => n.text).join('\n'), data);
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  return server;
}

// ---------- HTTP wiring ----------

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

export function startMcp(port = PORT) {
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, server: 'pregame-ping', provider: getProvider().name, transport: 'streamable-http' }));
    }
    if (url.pathname !== '/mcp') {
      res.writeHead(404).end('Not found');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST', 'content-type': 'application/json' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
    }
    try {
      const body = await readJson(req);
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error('MCP error', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
      }
    }
  });
  return new Promise((resolve) => httpServer.listen(port, () => resolve(httpServer)));
}

if (isMain(import.meta.url)) {
  startMcp().then(() => console.log(`Pregame Ping MCP server on http://localhost:${PORT}/mcp (data: ${getProvider().label})`));
}
