# Color Wars

Color Wars is a real-time multiplayer chain-reaction strategy game for 2–8 players.

## How to play

- **Goal:** be the last player (or team) with dots on the board, or have the most dots when the overall game timer ends.
- **First move:** place your starting move on an empty cell to start with **3 dots everywhere**.
- **Later moves:** tap/click one of your own cells to add 1 dot.
- **Explosions:** when a cell reaches its critical mass, it bursts and sends 1 dot to each orthogonal neighbor, capturing them.
  - Corner: 2
  - Edge: 3
  - Center: 4
- **Chain reactions:** explosions can trigger more explosions.
- **Players:** 2–8 players online, or play single-player vs computer.
- **Timers:** choose an overall game timer of **10, 20, or 30 minutes**. Every turn is fixed to **1 minute** with a ring countdown. If a turn expires, a move is auto-played; if the overall game timer expires, the game ends and the winner is decided by most dots (then cells).
- **Options:** choose board shape/grid and team mode. Online rooms support FFA and team modes (2v2 with 4 players, 3v3 with 6 players).
- **Spectator mode:** anyone with a room code can watch as a spectator (read-only). Spectator presence is visible to everyone in the room/lobby/game. If a waiting room becomes empty, a spectator can join as a player and take the host seat.

## Project structure

```text
.
├─ client/   # React + Vite frontend
├─ server/   # Hono WebSocket server and Cloudflare Worker/Durable Object backend
├─ shared/   # Shared TypeScript game rules/types
└─ README.md
```

## Requirements

- [Bun](https://bun.sh/)

## Local development / self-hosting

### 1. Install dependencies

```bash
bun install
```

### 2. Build shared package (recommended before first run)

```bash
bun run --filter @game/shared build
```

### 3. Start the game server

```bash
bun run dev:server
```

- Default local server: `http://localhost:3001`
- WebSocket endpoint: `/ws` (e.g. `ws://localhost:3001/ws`)

### 4. Start the client

In a second terminal:

```bash
bun run dev:client
```

- Default local client: `http://localhost:5173`
- By default, if `VITE_WS_URL` is not set, the client uses `ws://<current-host>:3001/ws` for local development.

Open the client in your browser, create a room, and share the room code.

## Configuration

### Client environment variable

| Variable | Required | Description |
|---|---|---|
| `VITE_WS_URL` | For non-local / production setups | WebSocket server base URL used by the client (for example `ws://localhost:3001` or `wss://your-domain.example`). The client connects to `/ws`. |

Notes:
- `VITE_WS_URL` is a **build-time** value. Rebuild/redeploy the client after changing it.
- Use `wss://` when the client is served over `https://`.

## Build

```bash
bun run build
```

This builds and typechecks `shared`, `client`, and `server`, including the
Cloudflare Worker/Durable Object files (`server/tsconfig.cf.json`).

## Testing

Test suites live in `e2e/` (shared rules, Node WebSocket protocol, and
Playwright browser flows). With the client and server running:

```bash
bun e2e/shared-check.ts
cd e2e
bun install
bun run test
```

See `e2e/README.md` for environment variables, individual suites, and artifacts.

## Self-hosting options

### Option A: Node/Bun server + static client

1. Run the server (`server/src/index.ts`) on a host reachable by players.
2. Build the client with `VITE_WS_URL` pointing to your server:
   ```bash
   bun install
   bun run --filter @game/shared build
   VITE_WS_URL=wss://your-server-domain bun run --filter @game/client build
   ```
3. Serve `client/dist` with any static file host (Nginx, Caddy, Apache, Cloudflare Pages, etc.).
4. Ensure WebSocket traffic to your server `/ws` endpoint is reachable (and proxied correctly if behind a reverse proxy).

### Option B: Cloudflare Workers (backend) + static client

The repository includes a Cloudflare Worker/Durable Object backend in `server/` (`wrangler.toml`, `src/cf.ts`, `src/RoomDO.ts`).

Deploy backend:

```bash
cd server
bunx wrangler deploy
```

Then build and host the client with:

```bash
VITE_WS_URL=wss://<your-worker-domain>
```

(Example: `wss://multiplayer-color-wars-server.<subdomain>.workers.dev`)

## Scripts

From repo root:

- `bun run dev:server` — start server in dev/watch mode
- `bun run dev:client` — start Vite client dev server
- `bun run build` — build shared, client, and server; typecheck Cloudflare worker files
- `bun run test:e2e` — run protocol, core, and edge suites (see `e2e/README.md`)

Server package (`server/`):

- `bun run dev` — run Node/Bun WebSocket server locally
- `bun run start` — start server
- `bun run cf:dev` — run Cloudflare Worker locally with Wrangler
- `bun run cf:deploy` — deploy Cloudflare Worker
