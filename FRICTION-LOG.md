# Friction log and product feedback notes

Fill in the "Observed" lines from your own experience. Only claim what you hit yourself.
Entries with a task, steps, expected vs actual, severity, workaround and suggestion can earn up to a 10% judging bonus.

## MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.32.1)

- **Task:** a stateless Streamable HTTP server with seven tools, and an MCP client in the simulator.
- **Steps:** `McpServer` + `registerTool` with zod input shapes; a fresh server and
  `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per POST to `/mcp`.
- **Worked:** the official client completed `initialize`, `tools/list` and `tools/call` against it
  (`test/e2e.mjs`), including tool errors returned with `isError`.
- **Observed:** _(add anything that surprised you)_

## Alexa+ developer tooling

- **Task:** register the self-hosted server with Alexa+ and have a device or the Add-on inspector call it.
- **Open question:** how do proactive announcements work? The server exposes `check_notifications`; what
  calls it, and can Alexa+ speak the result without being asked?
- **Observed:** _(not done yet: record the exact steps, what you expected and what happened)_
- **Severity:** _(critical / important / nice-to-have)_
- **Workaround:** the simulated Alexa+ in `src/sim.js`, which polls `check_notifications`.
- **Suggestion:** _(one actionable change)_

## Sports data

- **Task:** get schedules, venues and live scores without an API key.
- **Observed:** ESPN's public scoreboard feed has what is needed but is unofficial and undocumented.
  A date-by-date lookup is needed to cover a team's upcoming games. A documented, keyed alternative would be safer for production.

## Feature requests (optional)

- _(what you would want built, why it matters, urgency: critical / important / nice-to-have)_
