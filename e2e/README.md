# End-to-end tests

Reproducible test suites for Color Wars:

- `protocol.mjs` — 16 WebSocket protocol checks against the Node server
  (rooms, joins, reconnect, spectators, spectator-to-player promotion, team modes,
  validation, rate limits, leave/rejoin semantics).
- `core.mjs` — 10 Playwright browser tests for the main flows.
- `edge.mjs` — 6 Playwright browser tests for edge cases and abuse guards.

The browser tests drive the real Vite client and the Node WebSocket server,
including multiplayer rooms with multiple browser contexts, reconnects,
spectators, team modes, timers, and abuse guards.

## Prerequisites

- Bun or Node.js (for the protocol suite)
- Google Chrome (defaults to `/usr/bin/google-chrome`)
- Client and server running locally:

```bash
# from the repo root, in two terminals
bun run dev:server   # ws://localhost:3001/ws
bun run dev:client   # http://localhost:5173
```

Install the test dependency once:

```bash
cd e2e
bun install
```

## Run

```bash
cd e2e
bun run test          # protocol + core + edge suites
bun run test:protocol # WebSocket checks only (server only)
bun run test:core     # main browser flows
bun run test:edge     # shapes, disconnects, 3v3, protocol guards
```

Environment overrides:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:5173` | Vite client URL |
| `WS_URL` | `ws://localhost:3001/ws` | Node WebSocket URL used by protocol tests |
| `CHROME_PATH` | `/usr/bin/google-chrome` | Chrome/Chromium executable |

Screenshots and JSON reports are written to `e2e/artifacts/`.

## Notes

- The suites use isolated connections/browser contexts and unique room codes.
  They do not use production data.
- Timer tests intentionally wait for a fixed 1-minute turn timeout in cases
  that verify auto-play, so the core suite can take several minutes. The
  protocol suite runs quickly.
- Headless Chrome cannot verify actual speaker output or haptics; those are
  checked at the settings/persistence level.
