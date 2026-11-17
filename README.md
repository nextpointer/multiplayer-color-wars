# Multiplayer Color Wars (Chain Reaction)

Real-time multiplayer Chain Reaction game built with **React**, **Tailwind CSS**, and a **Hono** WebSocket server.

## Rules (standard)
- 2–8 players on a grid (size scales with player count).
- On your turn, place 1 orb in an **empty** cell or a cell **you own**.
- **Critical mass** = number of orthogonal neighbors: corners **2**, edges **3**, middle **4**.
- At critical mass a cell **explodes**: it loses that many orbs and sends 1 to each neighbor, **capturing** them. Explosions chain until stable.
- Players are eliminated when they have 0 orbs (after everyone has taken a first turn).
- Last player standing wins.

## Setup
```bash
npm install
npm run build -w shared
```

## Run (development)
Start server and client in separate terminals:
```bash
npm run dev:server   # ws/http server on :3001
npm run dev:client   # vite dev server on :5173
```
Open http://localhost:5173, create a room, and share the code to join (up to 8 players).

To point the client at a different server, set `VITE_WS_URL` (e.g. `ws://localhost:3001`).

## Features
- Standard Chain Reaction rules with chain-reaction resolution
- 2–8 player rooms with host start/rematch
- Dark & light UI (auto-detects system theme)
- Tailwind-powered animations (orb pop, critical glow, explosion burst, captures, turn highlights)
