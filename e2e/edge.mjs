import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const WS_URL = process.env.WS_URL || 'ws://localhost:3001/ws';
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SHOTS = path.join(ROOT, 'artifacts');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const pageErrors = [];
let browser;
const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function newPage(context, label) {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => pageErrors.push(`[${label}] ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    if (/favicon|WebSocket connection to .* failed|Download the React DevTools/i.test(t)) return;
    pageErrors.push(`[${label}] console.error: ${t.slice(0, 400)}`);
  });
  return page;
}

async function newContext(extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...extra });
  await ctx.addInitScript(() => {
    try {
      if (localStorage.getItem('cw.testInit')) return;
      localStorage.setItem('cw.testInit', '1');
      localStorage.setItem('cw.animQuality', 'minimal');
      localStorage.setItem('cw.muted', '1');
      localStorage.setItem('cw.haptics', '0');
      localStorage.setItem('cw.timerSounds', '0');
    } catch {}
  });
  return ctx;
}

async function gotoHome(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByText('COLOR WARS').first().waitFor({ timeout: 15000 });
  await page.waitForFunction(() => {
    const t = document.body.innerText;
    return !t.includes('Online multiplayer: connecting…') && !t.includes('Connecting for online play');
  }, null, { timeout: 15000 }).catch(() => {});
}

const btn = (page, name) => page.getByRole('button', { name, exact: true }).click();
const body = async (page) => { try { return await page.locator('body').innerText(); } catch { return ''; } };

async function createRoom(page, { name = 'Host', players = 2, team = 'FFA', shape = 'Grid', grid = '5×7', gameTime = null } = {}) {
  await page.getByText('Create online room', { exact: true }).click();
  await page.getByText('Create room', { exact: true }).first().waitFor();
  await page.locator('input[placeholder="Your name"]').fill(name);
  await btn(page, String(players));
  await btn(page, team);
  await btn(page, shape);
  await btn(page, grid);
  if (gameTime) await btn(page, gameTime);
  await btn(page, 'CREATE ROOM');
  await page.getByText('Game Lobby').waitFor({ timeout: 15000 });
  return (await page.locator('[data-testid="room-code"]').textContent()).trim();
}

async function joinRoom(page, { name, code }) {
  await page.getByText('Join room', { exact: true }).first().click();
  await page.locator('input[placeholder="Your name"]').fill(name);
  await page.locator('input[placeholder="ABCDE"]').fill(code);
  await btn(page, 'JOIN ROOM');
  await page.getByText('Game Lobby').waitFor({ timeout: 15000 });
}

async function startGame(page) {
  await btn(page, 'START GAME');
  await page.locator('[data-testid="game-screen"]').waitFor({ timeout: 20000 });
}

async function waitForToast(page, text, timeout = 8000) {
  await page.waitForFunction((t) => {
    const el = document.querySelector('[data-testid="toast"]');
    return !!el && (el.textContent || '').includes(t);
  }, text, { timeout });
}

async function isMyTurn(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="game-screen"]');
    return !!el && el.getAttribute('data-my-turn') === 'true';
  }).catch(() => false);
}

async function resultsVisible(page) {
  try { return await page.locator('[data-testid="results-screen"]').isVisible(); } catch { return false; }
}

async function takeTurn(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="game-screen"]');
    return !!el && el.getAttribute('data-my-turn') === 'true';
  }, null, { timeout: 20000 });
  const before = Number(await page.locator('[data-testid="game-screen"]').getAttribute('data-turn-count'));
  await page.locator('[data-testid="game-board"] [data-playable="true"]').first().click({ force: true });
  await page.waitForFunction((n) => {
    if (document.querySelector('[data-testid="results-screen"]')) return true;
    const el = document.querySelector('[data-testid="game-screen"]');
    return !!el && Number(el.getAttribute('data-turn-count')) > n;
  }, before, { timeout: 20000 });
}

async function playToResults(pages, maxMoves = 400) {
  for (let i = 0; i < maxMoves; i++) {
    for (const p of pages) if (await resultsVisible(p)) return true;
    let moved = false;
    for (const p of pages) {
      if (await isMyTurn(p)) {
        try { await takeTurn(p); moved = true; } catch {}
        break;
      }
    }
    if (!moved) await delay(250);
  }
  return (await Promise.all(pages.map(resultsVisible))).some(Boolean);
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
    try { await e.page?.screenshot({ path: `${SHOTS}/edge-${name.replace(/[^a-z0-9]+/gi, '-')}.png`, fullPage: true }); } catch {}
  }
}

(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
  });

  await test('all board shapes mask cells correctly', async () => {
    const ctx = await newContext();
    const page = await newPage(ctx, 'shapes');
    const shapes = ['Grid', 'Square', 'Diamond', 'Circle', 'Heart', 'Triangle', 'Cross', 'Ring'];
    const seen = {};
    for (const shape of shapes) {
      await gotoHome(page);
      await page.getByText('VS COMPUTER', { exact: true }).click();
      await page.locator('input[placeholder="Your name"]').fill('Shape');
      await btn(page, shape);
      await btn(page, 'START GAME');
      await page.locator('[data-testid="game-board"]').waitFor();
      const b = page.locator('[data-testid="game-board"]');
      const rows = Number(await b.getAttribute('data-rows'));
      const cols = Number(await b.getAttribute('data-cols'));
      const cells = await page.locator('[data-testid="game-board"] [data-cell]').count();
      if (cells <= 0) throw new Error(`${shape}: no cells rendered`);
      if (shape === 'Grid' || shape === 'Square') {
        if (cells !== rows * cols) throw new Error(`${shape}: expected ${rows * cols} cells, got ${cells}`);
      } else {
        if (cells >= rows * cols) throw new Error(`${shape}: mask did not trim cells (${cells}/${rows * cols})`);
        if (cells < rows * cols * 0.25) throw new Error(`${shape}: mask trimmed too much (${cells}/${rows * cols})`);
      }
      seen[shape] = `${cells}/${rows * cols}`;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText('COLOR WARS').first().waitFor();
    }
    console.log(`  info: shape cells ${JSON.stringify(seen)}`);
    await ctx.close();
  });

  await test('lobby disconnect frees slot and finished-room reload keeps results', async () => {
    const hc = await newContext();
    const gc = await newContext();
    const gc2 = await newContext();
    const hp = await newPage(hc, 'lobby-host');
    const gp = await newPage(gc, 'lobby-guest');
    const gp2 = await newPage(gc2, 'lobby-guest2');

    await gotoHome(hp);
    const code = await createRoom(hp, { name: 'Host', players: 2, grid: '5×7' });
    await gotoHome(gp);
    await joinRoom(gp, { name: 'Leaver', code });
    await hp.getByText(/2 \/ 2 joined/).waitFor();
    await gc.close();
    await hp.getByText(/1 \/ 2 joined/).waitFor({ timeout: 10000 });
    await gotoHome(gp2);
    await joinRoom(gp2, { name: 'Replacement', code });
    await hp.getByText(/2 \/ 2 joined/).waitFor({ timeout: 10000 });
    await startGame(hp);
    await gp2.locator('[data-testid="game-screen"]').waitFor({ timeout: 20000 });
    const finished = await playToResults([hp, gp2], 400);
    if (!finished) throw new Error('game did not finish for finished-room reconnect test');
    const winner = await hp.locator('[data-testid="results-screen"]').innerText();
    await hp.reload({ waitUntil: 'domcontentloaded' });
    await hp.locator('[data-testid="results-screen"]').waitFor({ timeout: 15000 });
    const afterReload = await hp.locator('[data-testid="results-screen"]').innerText();
    if (!/wins!/i.test(afterReload)) throw new Error(`results lost after reload: ${afterReload.slice(0, 160)}`);
    console.log(`  info: replacement join + finished reload kept "${winner.split('\n').find(l => /wins!/.test(l))?.trim()}"`);
    await hc.close(); await gc2.close();
  });

  await test('explicit leave removes player and does not auto-rejoin', async () => {
    const hc = await newContext();
    const gc = await newContext();
    const hp = await newPage(hc, 'leave-host');
    const gp = await newPage(gc, 'leave-guest');
    await gotoHome(hp);
    const code = await createRoom(hp, { name: 'Host', players: 2, grid: '5×7' });
    await gotoHome(gp);
    await joinRoom(gp, { name: 'Quitter', code });
    await startGame(hp);
    await gp.locator('[data-testid="game-screen"]').waitFor({ timeout: 20000 });
    await gp.getByRole('button', { name: 'Quit', exact: true }).click();
    await gp.getByText('Leave the match?', { exact: true }).waitFor();
    await gp.getByRole('button', { name: 'Leave', exact: true }).click();
    await gp.getByText('COLOR WARS').first().waitFor({ timeout: 15000 });
    let hostResult = null;
    for (let i = 0; i < 40; i++) {
      if (await resultsVisible(hp)) { hostResult = await hp.locator('[data-testid="results-screen"]').innerText(); break; }
      const owner1 = await hp.locator('[data-testid="game-board"] [data-owner="1"]').count().catch(() => -1);
      if (owner1 === 0) { hostResult = 'board-clean'; break; }
      await delay(250);
    }
    if (!hostResult) throw new Error('host did not observe the quitter removal');
    const guestSess = await gp.evaluate(() => localStorage.getItem('cw.session'));
    if (guestSess) throw new Error('left guest session was not cleared');
    console.log(`  info: leave observed (${hostResult === 'board-clean' ? 'cells removed' : 'win by elimination'})`);
    await hc.close(); await gc.close();
  });

  await test('3v3 start validation and six-player start', async () => {
    const host = await newContext();
    const guests = await Promise.all([0,1,2,3,4].map(() => newContext()));
    const hp = await newPage(host, '3v3-host');
    const gps = await Promise.all(guests.map((c, i) => newPage(c, `3v3-g${i}`)));
    await gotoHome(hp);
    const code = await createRoom(hp, { name: 'Host', players: 6, team: '3v3', grid: '9×9' });
    for (let i = 0; i < 4; i++) {
      await gotoHome(gps[i]);
      await joinRoom(gps[i], { name: `P${i + 1}`, code });
    }
    await hp.getByText(/5 \/ 6 joined/).waitFor();
    await btn(hp, 'START GAME');
    await waitForToast(hp, 'Team mode 3v3 requires 6 players', 8000);
    await gotoHome(gps[4]);
    await joinRoom(gps[4], { name: 'P5', code });
    await hp.getByText(/6 \/ 6 joined/).waitFor();
    const lobby = await body(hp);
    if (!/\(T[12]\)/.test(lobby)) throw new Error('3v3 lobby missing team labels');
    await delay(1500); // clear the client's 1.2s start action guard after the expected validation error
    await startGame(hp);
    await Promise.all(gps.map(p => p.locator('[data-testid="game-screen"]').waitFor({ timeout: 20000 })));
    const texts = await body(hp);
    if (!/T[12]/.test(texts)) throw new Error('3v3 game missing team labels');
    console.log('  info: 3v3 rejected at 5 players and started at 6');
    await host.close();
    await Promise.all(guests.map(c => c.close()));
  });

  await test('spectator joins full room and ?room= URL prefills join code', async () => {
    const hc = await newContext();
    const gc = await newContext();
    const sc = await newContext();
    const hp = await newPage(hc, 'full-host');
    const gp = await newPage(gc, 'full-guest');
    const sp = await newPage(sc, 'full-spec');
    await gotoHome(hp);
    const code = await createRoom(hp, { name: 'Host', players: 2, grid: '5×7' });
    await gotoHome(gp);
    await joinRoom(gp, { name: 'Guest', code });
    await hp.getByText(/2 \/ 2 joined/).waitFor();
    await sp.goto(`${BASE}/?room=${code}`, { waitUntil: 'domcontentloaded' });
    await sp.locator('input[placeholder="ABCDE"]').waitFor({ timeout: 15000 });
    const prefilled = await sp.locator('input[placeholder="ABCDE"]').inputValue();
    if (prefilled !== code) throw new Error(`?room= prefill mismatch: ${prefilled} vs ${code}`);
    await sp.locator('input[placeholder="Your name"]').fill('Watcher');
    await btn(sp, 'Watch as spectator');
    await sp.getByText('Watching as spectator').waitFor({ timeout: 10000 });
    await hp.getByText(/watching/).waitFor({ timeout: 10000 }).catch(() => {});
    console.log(`  info: full-room spectator joined ${code}`);
    await hc.close(); await gc.close(); await sc.close();
  });

  await test('protocol anti-abuse: invalid move, identity mismatch, duplicate tab guard', async () => {
    const ctx = await newContext();
    const page = await newPage(ctx, 'proto');
    await gotoHome(page);
    const proto = await page.evaluate(async (wsUrl) => {
      const log = [];
      const open = () => new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const queue = [];
        const waiters = [];
        ws.onmessage = (e) => {
          let m; try { m = JSON.parse(e.data); } catch { return; }
          const i = waiters.findIndex(w => w.pred(m));
          if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
          else queue.push(m);
        };
        ws.onerror = () => reject(new Error('ws error'));
        ws.onopen = () => resolve({
          ws,
          send: (o) => ws.send(JSON.stringify(o)),
          next: (pred, ms = 5000) => new Promise((res, rej) => {
            const hit = queue.findIndex(pred);
            if (hit >= 0) return res(queue.splice(hit, 1)[0]);
            const w = { pred, resolve: (m) => { clearTimeout(t); res(m); } };
            const t = setTimeout(() => {
              const idx = waiters.indexOf(w);
              if (idx >= 0) waiters.splice(idx, 1);
              rej(new Error('timeout waiting for message'));
            }, ms);
            waiters.push(w);
          }),
        });
      });

      const a = await open();
      a.send({ type: 'move', r: 0, c: 0 });
      const e1 = await a.next(m => m.type === 'error');
      log.push(`pre-join move: ${e1.message}`);

      a.send({ type: 'create', name: 'AntiA', maxPlayers: 2, grid: { rows: 5, cols: 7 }, shape: 'grid', gameTimeMinutes: 10, teamMode: 'off', clientId: 'anti-a', tabId: 'tab-a' });
      const room = await a.next(m => m.type === 'room');
      log.push(`room created: ${room.roomId}`);

      const b = await open();
      b.send({ type: 'rejoin', roomId: room.roomId, playerId: 0, clientId: 'anti-b', tabId: 'tab-b' });
      const e2 = await b.next(m => m.type === 'error');
      log.push(`identity mismatch: ${e2.message}`);

      const c = await open();
      c.send({ type: 'rejoin', roomId: room.roomId, playerId: 0, clientId: 'anti-a', tabId: 'tab-c' });
      const e3 = await c.next(m => m.type === 'error');
      log.push(`duplicate tab: ${e3.message}`);
      b.ws.close(); c.ws.close();

      const d = await open();
      d.send({ type: 'rejoin', roomId: room.roomId, playerId: 0, clientId: 'anti-a', tabId: 'tab-a' });
      const room2 = await d.next(m => m.type === 'room');
      log.push(`same-tab reconnect: ${room2.role}`);
      d.ws.close(); a.ws.close();
      return log;
    }, WS_URL);
    if (!proto.some(l => /Join or create a room first/.test(l))) throw new Error(`pre-join move not rejected: ${proto.join(' | ')}`);
    if (!proto.some(l => /Session mismatch/.test(l))) throw new Error(`identity mismatch not rejected: ${proto.join(' | ')}`);
    if (!proto.some(l => /Already connected in another tab/.test(l))) throw new Error(`duplicate tab not rejected: ${proto.join(' | ')}`);
    if (!proto.some(l => /same-tab reconnect: player/.test(l))) throw new Error(`same-tab reconnect failed: ${proto.join(' | ')}`);
    console.log(`  info: ${proto.join('; ')}`);
    await ctx.close();
  });

  await browser.close();
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  fs.writeFileSync(path.join(SHOTS, 'edge-report.json'), JSON.stringify({ results, pageErrors }, null, 2));
  console.log(`\nEDGE SUMMARY: ${passed} passed, ${failed} failed`);
  for (const r of results) if (!r.ok) console.log(`  - FAIL: ${r.name}\n    ${String(r.error).split('\n')[0]}`);
  if (pageErrors.length) {
    console.log(`\nPAGE ERRORS (${pageErrors.length}):`);
    for (const e of pageErrors.slice(0, 20)) console.log('  -', e);
  }
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('FATAL', e);
  try { await browser?.close(); } catch {}
  process.exit(2);
});
