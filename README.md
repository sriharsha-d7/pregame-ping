# Pregame Ping

Ask Alexa+ when and where your team plays, then choose how you want to hear about it:
**how long before each game to be reminded**, and **how often to get score updates during it**.

> "When do the Harbor Gulls play?"
> "Follow the Gulls and remind me a day and an hour before."
> "Update me at the end of every quarter." / "Update me every 10 minutes." / "Tell me every time they score."

Pregame Ping is a **self-hosted MCP server** (Streamable HTTP, stateless) plus a **simulated Alexa+ web app** styled as an Echo Show screen.
Built for the Amazon Developer Hackathon, **Alexa+ track**.

## What is different

Sports MCP servers that already exist (ESPN and SportRadar wrappers, for example) answer questions:
scores, schedules, standings. Pregame Ping adds **memory and timing**: it remembers which teams you
follow and *your* preferences for each one, and works out what is due right now.

| You can say | Setting it controls |
| --- | --- |
| "remind me a day, an hour and 15 minutes before" | up to five reminder lead times per team |
| "update me at the end of every quarter" | `period`: when a quarter, half or period changes |
| "update me every 10 minutes" | `interval`: every N minutes (5 to 120) while a game is on |
| "tell me every time they score" | `score`: whenever the score changes |
| "just the final score" / "no updates" | `final` / `none` |

If several reminders come due at the same moment (you followed a team 10 minutes before a game), only the
closest one is spoken. A reminder is only for a moment that came after you followed the team.

## MCP tools

`find_games`, `next_game`, `game_status`, `follow_team`, `unfollow_team`, `list_follows`, `check_notifications`

### How reminders and updates are delivered

MCP is request and response, so a server cannot push to Alexa on its own. Pregame Ping keeps an outbox:
`check_notifications` works out what is due and returns each message once. The simulator calls it every
three seconds. A deployment would call it from whatever drives Alexa+ announcements.

> Not verified: how a real Alexa+ device would trigger `check_notifications` or speak proactive
> announcements. Confirm in the Alexa+ track resources. See `FRICTION-LOG.md`.

## Two data modes

| Mode | Set with | Use it for |
| --- | --- | --- |
| **Simulated league** (default) | nothing | Demos. Fictional teams and a clock you can fast-forward, so a reminder and live score updates happen in seconds. No real team names or logos on screen. |
| **Live ESPN data** | `SPORTS_PROVIDER=espn` | Real schedules, venues and scores for the NBA, NFL, NHL, MLB, WNBA, Premier League and MLS. |

The live mode reads ESPN's public scoreboard feed. **It is unofficial and undocumented**, so it can change or
stop working. The field paths the code depends on were checked against a live response; the parsing and error
handling are covered by tests that use a fake feed (`test/espn.test.mjs`). The live mode was **not run
against the real service from the build environment**, so run it once on your machine before relying on it.

## Run it

Requires Node 20 or newer.

```bash
npm install
npm start                         # simulator http://localhost:8080, MCP server http://localhost:3000/mcp
SPORTS_PROVIDER=espn npm start    # same, with live data
npm run mcp                       # only the MCP server
```

Open http://localhost:8080. In demo mode use **Skip 15 min**, **Skip 1 hour** and
**Jump to 10 min before the next game** to move the clock. See `DEMO.md` for a 3-minute walkthrough.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SPORTS_PROVIDER` | `demo` | `demo` or `espn` |
| `USER_TZ` | `America/New_York` | Time zone used when speaking times |
| `ESPN_LEAGUES` | `nba,nfl,nhl,mlb,wnba,epl,mls` | Leagues searched when none is named. Also available: `ncaaf`, `ncaamb` |
| `MCP_PORT` / `SIM_PORT` | `3000` / `8080` | Ports |
| `MCP_URL` | (unset) | Point the simulator at an already running or deployed MCP server |
| `PING_DB` | `data/follows.json` | Where followed teams are stored |
| `DEMO_NOW` | (unset) | Freeze the clock at an ISO time (used by tests) |

```bash
npm test      # end-to-end MCP test over HTTP, ESPN provider tests, phrase router tests
```

## Registering with Alexa+

Alexa+ treats a self-hosted MCP server like any other MCP client. Expose `/mcp` over HTTPS (a tunnel or a
small cloud host) and register that URL in the Alexa+ developer tooling from the hackathon's track resources.

## Layout

| Path | What it is |
| --- | --- |
| `src/server.js` | MCP server and tools, Streamable HTTP on `/mcp`, health check on `/healthz` |
| `src/follows.js` | Followed teams, per-team settings, and the engine that decides what is due |
| `src/games.js` | Team matching (including ambiguous names like "Giants") and the spoken wording |
| `src/providers/` | `demo.js` (simulated league) and `espn.js` (live) |
| `src/clock.js` | Fast-forwardable clock and time formatting |
| `src/sim.js`, `public/index.html` | Simulated Alexa+: phrase router, notification polling, UI |
| `test/` | Tests |

The simulator's "brain" is a deterministic phrase router so it runs offline with no API keys. Giving an LLM the
MCP tool list instead would allow open-ended conversation; the server does not change.

## License

MIT, see `LICENSE`.
