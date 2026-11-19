# Color Wars

Color Wars is a real-time multiplayer chain-reaction strategy game for 2–8 players.

## How to play

- **Goal:** be the last player with dots on the board.
- **First move:** place your starting move on an empty cell (creates 3 dots).
- **Later moves:** tap/click one of your own cells to add 1 dot.
- **Explosions:** when a cell reaches its critical mass, it bursts and sends 1 dot to each orthogonal neighbor, capturing them.
  - Corner: 2
  - Edge: 3
  - Center: 4
- **Chain reactions:** explosions can trigger more explosions.
- **Players:** 2–8 players (board size can be selected when creating an online room; defaults are automatic).

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

This builds `shared`, `client`, and `server`.

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
- `bun run build` — build shared, client, and server

Server package (`server/`):

- `bun run dev` — run Node/Bun WebSocket server locally
- `bun run start` — start server
- `bun run cf:dev` — run Cloudflare Worker locally with Wrangler
- `bun run cf:deploy` — deploy Cloudflare Worker
