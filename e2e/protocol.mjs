import fs from 'fs';
import path from 'path';

const WS_URL = process.env.WS_URL || 'ws://localhost:3001/ws';
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SHOTS = path.join(ROOT, 'artifacts');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

class Client {
  constructor() {
    this.queue = [];
    this.waiters = [];
    this.closed = false;
  }

  static open(url = WS_URL) {
    return new Promise((resolve, reject) => {
      const c = new Client();
      const ws = new WebSocket(url);
      c.ws = ws;
      const timer = setTimeout(() => reject(new Error(`WebSocket open timeout: ${url}`)), 5000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(c);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`WebSocket error: ${url}`));
      };
      ws.onmessage = (event) => c._recv(event.data);
      ws.onclose = (event) => c._closed(event.code, event.reason);
    });
  }

  _recv(data) {
    let msg;
    try { msg = JSON.parse(typeof data === 'string' ? data : String(data)); } catch { return; }
    const i = this.waiters.findIndex((w) => w.pred(msg));
    if (i >= 0) {
      const w = this.waiters.splice(i, 1)[0];
      clearTimeout(w.timer);
      w.resolve(msg);
      return;
    }
    this.queue.push(msg);
    if (this.queue.length > 500) this.queue.shift();
  }

  _closed(code, reason) {
    this.closed = true;
    for (const w of this.waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(new Error(`Socket closed (${code}${reason ? `: ${reason}` : ''})`));
    }
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  next(pred, timeout = 6000) {
    const i = this.queue.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve, reject, timer: null };
      w.timer = setTimeout(() => {
        const idx = this.waiters.indexOf(w);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error('Timed out waiting for server message'));
      }, timeout);
      this.waiters.push(w);
    });
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

let active = [];
async function openClient() {
  const c = await Client.open(WS_URL);
  active.push(c);
  return c;
}

function ids(prefix) {
  const r = Math.random().toString(36).slice(2, 10);
  return { clientId: `${prefix}-client-${r}`, tabId: `${prefix}-tab-${r}` };
}

async function createRoom(opts = {}) {
  const c = await openClient();
  const ident = opts.clientId ? { clientId: opts.clientId, tabId: opts.tabId || `t-${Math.random().toString(36).slice(2, 10)}` } : ids(opts.identPrefix || 'create');
  c.send({
    type: 'create',
    name: opts.name || 'Host',
    maxPlayers: opts.maxPlayers ?? 2,
    grid: opts.grid === undefined ? { rows: 5, cols: 7 } : opts.grid,
    shape: opts.shape || 'grid',
    gameTimeMinutes: opts.gameTimeMinutes || 10,
    teamMode: opts.teamMode || 'off',
    ...ident,
  });
  const room = await c.next((m) => m.type === 'room');
  return { c, room, ...ident };
}

async function joinRoom(roomId, opts = {}) {
  const c = await openClient();
  const ident = opts.clientId ? { clientId: opts.clientId, tabId: opts.tabId || `t-${Math.random().toString(36).slice(2, 10)}` } : ids(opts.identPrefix || 'join');
  c.send({ type: 'join', roomId, name: opts.name || 'Guest', ...ident });
  const room = await c.next((m) => m.type === 'room');
  return { c, room, ...ident };
}

async function startGame(host, clients) {
  host.send({ type: 'start' });
  const msgs = await Promise.all(clients.map((c) => c.next((m) => m.type === 'state' && m.state?.status === 'playing')));
  return msgs[0].state;
}

function currentId(state) {
  return state.players[state.currentPlayerIndex].id;
}

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`PASS - ${name} (${Date.now() - started}ms)`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.stack || e), ms: Date.now() - started });
    console.log(`FAIL - ${name} :: ${e.message}`);
  } finally {
    for (const c of active) c.close();
    active = [];
    await sleep(60);
  }
}

(async () => {
  await test('1. create room returns waiting state and host/player data', async () => {
    const a = await createRoom({ name: 'A', maxPlayers: 2, gameTimeMinutes: 20 });
    assert(a.room.state.status === 'waiting', `expected waiting, got ${a.room.state.status}`);
    assert(a.room.playerId === 0 && a.room.hostId === 0, `bad host/player ids: ${a.room.playerId}/${a.room.hostId}`);
    assert(a.room.players.length === 1 && a.room.players[0].name === 'A', 'host player missing');
    assert(a.room.role === 'player', `bad role ${a.room.role}`);
    assert(a.room.state.gameTimeMinutes === 20, `expected 20 min game, got ${a.room.state.gameTimeMinutes}`);
    assert(a.room.state.turnDurationMs === 60000, `expected 60s turns, got ${a.room.state.turnDurationMs}`);
  });

  await test('2. second player joins and host receives updated lobby', async () => {
    const a = await createRoom({ name: 'Host', maxPlayers: 2, identPrefix: 'two-a' });
    const b = await joinRoom(a.room.roomId, { name: 'Guest', identPrefix: 'two-b' });
    assert(b.room.playerId === 1, `guest playerId should be 1, got ${b.room.playerId}`);
    assert(b.room.players.length === 2, `guest should see 2 players, got ${b.room.players.length}`);
    const hostRoom = await a.c.next((m) => m.type === 'room' && m.players.length === 2);
    assert(hostRoom.players[1].name === 'Guest', 'host presence did not include guest');
  });

  await test('3. duplicate join with the same clientId is blocked', async () => {
    const a = await createRoom({ name: 'Owner', maxPlayers: 3, clientId: 'dup-client', tabId: 'dup-tab-a' });
    const copy = await openClient();
    copy.send({ type: 'join', roomId: a.room.roomId, name: 'Copy', clientId: 'dup-client', tabId: 'dup-tab-b' });
    const err = await copy.next((m) => m.type === 'error');
    assert(/Already joined this room/i.test(err.message), `unexpected duplicate-join error: ${err.message}`);
  });

  await test('4. disconnect during play removes player cells', async () => {
    const a = await createRoom({ name: 'A', maxPlayers: 3, identPrefix: 'disc-a' });
    const b = await joinRoom(a.room.roomId, { name: 'B', identPrefix: 'disc-b' });
    const c = await joinRoom(a.room.roomId, { name: 'C', identPrefix: 'disc-c' });
    const metas = { 0: a, 1: b, 2: c };
    let state = await startGame(a.c, [a.c, b.c, c.c]);

    const cp = state.players[state.currentPlayerIndex].id;
    metas[cp].c.send({ type: 'move', r: 3, c: 3 });
    state = (await metas[cp].c.next((m) => m.type === 'state' && m.state.turnCount === 1)).state;
    const np = state.players[state.currentPlayerIndex].id;
    metas[np].c.send({ type: 'move', r: 2, c: 2 });
    state = (await metas[np].c.next((m) => m.type === 'state' && m.state.turnCount === 2)).state;
    assert(state.board[3][3].owner === cp && state.board[2][2].owner === np, 'setup moves were not owned correctly');

    metas[np].c.close();
    const after = await metas[cp].c.next((m) => m.type === 'state' && m.state.players.some((p) => p.id === np && p.alive === false), 8000);
    assert(after.state.board.every((row) => row.every((cell) => cell.owner !== np)), 'disconnected player cells remain on the board');
    assert(after.state.status === 'playing', `3-player game should continue after one disconnect, got ${after.state.status}`);
  });

  await test('5. rejoin with a mismatched clientId is rejected', async () => {
    const a = await createRoom({ name: 'A', maxPlayers: 2, clientId: 'owner-5', tabId: 'owner-tab-5' });
    const attacker = await openClient();
    attacker.send({ type: 'rejoin', roomId: a.room.roomId, playerId: 0, name: 'Attacker', clientId: 'attacker-5', tabId: 'attacker-tab-5' });
    const err = await attacker.next((m) => m.type === 'error');
    assert(/Session mismatch/i.test(err.message), `unexpected identity error: ${err.message}`);
  });

  await test('6. only the host can start the game', async () => {
    const a = await createRoom({ name: 'Host', maxPlayers: 2, identPrefix: 'start-a' });
    const b = await joinRoom(a.room.roomId, { name: 'Guest', identPrefix: 'start-b' });
    b.c.send({ type: 'start' });
    const err = await b.c.next((m) => m.type === 'error');
    assert(/Only host can start/i.test(err.message), `unexpected guest-start error: ${err.message}`);
  });

  await test('7. out-of-turn and masked moves are rejected', async () => {
    const a = await createRoom({ name: 'A', maxPlayers: 2, identPrefix: 'move-a' });
    const b = await joinRoom(a.room.roomId, { name: 'B', identPrefix: 'move-b' });
    const state = await startGame(a.c, [a.c, b.c]);
    const cp = currentId(state);
    const wrong = cp === 0 ? b.c : a.c;
    wrong.send({ type: 'move', r: 0, c: 0 });
    const err1 = await wrong.next((m) => m.type === 'error');
    assert(/Not your turn/i.test(err1.message), `unexpected out-of-turn error: ${err1.message}`);

    const h = await createRoom({ name: 'H', maxPlayers: 2, shape: 'heart', grid: null, identPrefix: 'mask-h' });
    const h2 = await joinRoom(h.room.roomId, { name: 'H2', identPrefix: 'mask-h2' });
    const hs = await startGame(h.c, [h.c, h2.c]);
    assert(hs.mask && hs.mask[0][0] === false, 'expected heart board to mask cell 0,0');
    const hcp = currentId(hs);
    const hc = hcp === 0 ? h.c : h2.c;
    hc.send({ type: 'move', r: 0, c: 0 });
    const err2 = await hc.next((m) => m.type === 'error');
    assert(/Cell not available/i.test(err2.message), `unexpected masked-move error: ${err2.message}`);
  });

  await test('8. malformed and out-of-range move coordinates are rejected', async () => {
    const a = await createRoom({ name: 'A', maxPlayers: 2, identPrefix: 'coord-a' });
    const b = await joinRoom(a.room.roomId, { name: 'B', identPrefix: 'coord-b' });
    const state = await startGame(a.c, [a.c, b.c]);
    const cp = currentId(state);
    const mover = cp === 0 ? a.c : b.c;
    for (const coords of [{ r: -1, c: 0 }, { r: 0, c: 'x' }, { r: 101, c: 0 }]) {
      mover.send({ type: 'move', ...coords });
      const err = await mover.next((m) => m.type === 'error');
      assert(/Invalid move/i.test(err.message), `coordinates ${JSON.stringify(coords)} produced: ${err.message}`);
    }
  });

  await test('9. rapid message flood hits the per-connection rate limiter', async () => {
    const c = await openClient();
    for (let i = 0; i < 80; i++) c.send({ type: 'ping', ts: i });
    const err = await c.next((m) => m.type === 'error' && /Too many requests/i.test(m.message), 8000);
    assert(!!err, 'rate limiter did not reject the flood');
  });

  await test('10. spectator receives live state and cannot move', async () => {
    const a = await createRoom({ name: 'A', maxPlayers: 2, identPrefix: 'spec-a' });
    const b = await joinRoom(a.room.roomId, { name: 'B', identPrefix: 'spec-b' });
    const state = await startGame(a.c, [a.c, b.c]);

    const spec = await openClient();
    spec.send({ type: 'spectate', roomId: a.room.roomId, name: 'Spec', ...ids('spec') });
    const room = await spec.next((m) => m.type === 'room');
    assert(room.role === 'spectator', `expected spectator role, got ${room.role}`);
    assert(room.playerId === -1, `spectator playerId should be -1, got ${room.playerId}`);

    const cp = currentId(state);
    const mover = cp === 0 ? a.c : b.c;
    mover.send({ type: 'move', r: 0, c: 0 });
    const live = await spec.next((m) => m.type === 'state' && m.state.turnCount === 1);
    assert(live.state.board[0][0].owner === cp, 'spectator state missing the move');

    spec.send({ type: 'move', r: 0, c: 1 });
    const err = await spec.next((m) => m.type === 'error');
    assert(/Spectators cannot perform this action/i.test(err.message), `unexpected spectator action error: ${err.message}`);
  });

  await test('11. 2v2 lobby preserves team mode before four players', async () => {
    const a = await createRoom({ name: 'A', maxPlayers: 4, teamMode: '2v2', grid: { rows: 9, cols: 9 }, identPrefix: 'teams-a' });
    assert(a.room.state.teamMode === '2v2', `lobby teamMode should be 2v2, got ${a.room.state.teamMode}`);
    const b = await joinRoom(a.room.roomId, { name: 'B', identPrefix: 'teams-b' });
    const room2 = await a.c.next((m) => m.type === 'room' && m.players.length === 2);
    assert(room2.state.teamMode === '2v2', `2-player lobby lost team mode: ${room2.state.teamMode}`);
    assert(room2.state.teamsCount === 2, `expected 2 teams, got ${room2.state.teamsCount}`);
    assert(JSON.stringify(room2.state.players.map((p) => p.team)) === '[0,1]', '2-player teams not interleaved');
    a.c.send({ type: 'start' });
    const err = await a.c.next((m) => m.type === 'error');
    assert(/requires 4 players/i.test(err.message), `unexpected 2v2 underfill error: ${err.message}`);
  });

  await test('12. 2v2 starts with exactly four players', async () => {
    const a = await createRoom({ name: 'A', maxPlayers: 4, teamMode: '2v2', grid: { rows: 9, cols: 9 }, identPrefix: '2v2-a' });
    const b = await joinRoom(a.room.roomId, { name: 'B', identPrefix: '2v2-b' });
    const c = await joinRoom(a.room.roomId, { name: 'C', identPrefix: '2v2-c' });
    const d = await joinRoom(a.room.roomId, { name: 'D', identPrefix: '2v2-d' });
    await a.c.next((m) => m.type === 'room' && m.players.length === 4);
    const state = await startGame(a.c, [a.c, b.c, c.c, d.c]);
    assert(state.teamMode === '2v2' && state.teamsCount === 2, '2v2 metadata missing after start');
    assert(JSON.stringify(state.players.map((p) => p.team)) === '[0,1,0,1]', '2v2 teams not interleaved');
  });

  await test('13. 3v3 start is rejected with fewer than six players', async () => {
    const a = await createRoom({ name: 'A', maxPlayers: 6, teamMode: '3v3', grid: { rows: 9, cols: 9 }, identPrefix: '3v3-a' });
    const rest = [];
    for (let i = 1; i <= 4; i++) rest.push(await joinRoom(a.room.roomId, { name: `P${i}`, identPrefix: `3v3-p${i}` }));
    await a.c.next((m) => m.type === 'room' && m.players.length === 5);
    a.c.send({ type: 'start' });
    const err = await a.c.next((m) => m.type === 'error');
    assert(/requires 6 players/i.test(err.message), `unexpected 3v3 underfill error: ${err.message}`);
  });

  await test('14. 3v3 starts with exactly six players', async () => {
    const a = await createRoom({ name: 'A', maxPlayers: 6, teamMode: '3v3', grid: { rows: 9, cols: 9 }, identPrefix: 'six-a' });
    const clients = [a.c];
    for (let i = 1; i <= 5; i++) {
      const p = await joinRoom(a.room.roomId, { name: `P${i}`, identPrefix: `six-p${i}` });
      clients.push(p.c);
    }
    await a.c.next((m) => m.type === 'room' && m.players.length === 6);
    const state = await startGame(a.c, clients);
    assert(state.teamMode === '3v3' && state.teamsCount === 2, '3v3 metadata missing after start');
    assert(JSON.stringify(state.players.map((p) => p.team)) === '[0,1,0,1,0,1]', '3v3 teams not interleaved');
  });

  await test('15. explicit leave and disconnect remove player cells', async () => {
    const a = await createRoom({ name: 'A', maxPlayers: 3, grid: { rows: 7, cols: 7 }, identPrefix: 'leave-a' });
    const b = await joinRoom(a.room.roomId, { name: 'B', identPrefix: 'leave-b' });
    const c = await joinRoom(a.room.roomId, { name: 'C', identPrefix: 'leave-c' });
    const metas = { 0: a, 1: b, 2: c };
    let state = await startGame(a.c, [a.c, b.c, c.c]);

    const cp = currentId(state);
    metas[cp].c.send({ type: 'move', r: 3, c: 3 });
    state = (await metas[cp].c.next((m) => m.type === 'state' && m.state.turnCount === 1)).state;
    const np = currentId(state);
    metas[np].c.send({ type: 'move', r: 2, c: 2 });
    state = (await metas[np].c.next((m) => m.type === 'state' && m.state.turnCount === 2)).state;
    assert(state.board[3][3].owner === cp && state.board[2][2].owner === np, 'setup moves were not owned correctly');

    // Explicit leave removes cells and marks player out.
    metas[cp].c.send({ type: 'leave' });
    const afterLeave = await metas[np].c.next((m) => m.type === 'state' && m.state.players.some((p) => p.id === cp && p.alive === false));
    assert(afterLeave.state.status === 'playing', `3-player game should continue after one leave, got ${afterLeave.state.status}`);
    assert(afterLeave.state.board.every((row) => row.every((cell) => cell.owner !== cp)), 'leaver cells remain on the board after explicit leave');

    // Disconnect (player gone without explicit leave) also removes cells.
    const tp = [0, 1, 2].find((id) => id !== cp && id !== np);
    metas[np].c.close();
    const afterDisc = await metas[tp].c.next((m) => m.type === 'state' && m.state.players.some((p) => p.id === np && p.alive === false), 8000);
    assert(afterDisc.state.board.every((row) => row.every((cell) => cell.owner !== np)), 'disconnected player cells remain on the board');
  });

  await test('16. spectator can become player in empty waiting room', async () => {
    const host = await createRoom({ name: 'Host', maxPlayers: 4, gameTimeMinutes: 10, identPrefix: 'empty-host' });
    const roomId = host.room.roomId;
    const specIdent = ids('empty-spec');
    const spec = await openClient();
    spec.send({ type: 'spectate', roomId, name: 'Watcher', ...specIdent });
    const specRoom = await spec.next((m) => m.type === 'room' && m.role === 'spectator');
    assert(specRoom.spectatorsCount >= 1, 'spectator count missing');

    // Host leaves waiting room; room should remain because spectator is present.
    host.c.send({ type: 'leave' });
    const afterLeave = await spec.next((m) => m.type === 'room' && Array.isArray(m.players) && m.players.length === 0, 8000).catch(async () => {
      // Some implementations may emit presence/state first; accept state/presence evidence too.
      const p = await spec.next((m) => (m.type === 'presence' || m.type === 'state' || m.type === 'room') && m.spectatorsCount >= 1, 8000);
      return p;
    });
    assert(afterLeave, 'spectator did not receive room update after host left');

    spec.send({ type: 'become_player', name: 'Watcher' });
    const became = await spec.next((m) => m.type === 'room' && m.role === 'player', 8000);
    assert(became.playerId === 0, `new player should become player 0, got ${became.playerId}`);
    assert(became.hostId === 0, `new player should become host, got ${became.hostId}`);
    assert(became.players.length === 1 && became.players[0].name === 'Watcher', 'player not promoted correctly');
    assert(became.state.status === 'waiting', `room should remain waiting, got ${became.state.status}`);
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  fs.writeFileSync(path.join(SHOTS, 'protocol-report.json'), JSON.stringify({ results }, null, 2));
  console.log(`\nPROTOCOL SUMMARY: ${passed} passed, ${failed} failed`);
  for (const r of results) if (!r.ok) console.log(`  - FAIL: ${r.name}\n    ${String(r.error).split('\n')[0]}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
