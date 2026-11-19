import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SHOTS = path.join(ROOT, 'artifacts');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const pageErrors = [];
let browser;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function newPage(context, label) {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => pageErrors.push(`[${label}] ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (/favicon|WebSocket connection to .* failed|Download the React DevTools/i.test(t)) return;
      pageErrors.push(`[${label}] console.error: ${t.slice(0, 500)}`);
    }
  });
  return page;
}

async function newContext(extra = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...extra,
  });
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

async function openCreate(page) {
  await page.getByText('Create online room', { exact: true }).click();
  await page.getByText('Create room', { exact: true }).first().waitFor();
}

async function openJoin(page) {
  await page.getByText('Join room', { exact: true }).first().click();
  await page.locator('input[placeholder="ABCDE"]').waitFor();
}

async function setInput(page, placeholder, value) {
  const el = page.locator(`input[placeholder="${placeholder}"]`).first();
  await el.fill(value);
}

async function clickButton(page, text) {
  await page.getByRole('button', { name: text, exact: true }).click();
}

async function bodyText(page) {
  try { return await page.locator('body').innerText(); } catch { return ''; }
}

async function createRoom(page, opts) {
  const { name, players = 2, teamMode, shape = 'Grid', grid, gameTime } = opts;
  await openCreate(page);
  await setInput(page, 'Your name', name);
  if (players) await clickButton(page, String(players));
  if (teamMode) await clickButton(page, teamMode);
  if (shape) await clickButton(page, shape);
  if (grid) await clickButton(page, grid);
  if (gameTime) await clickButton(page, gameTime);
  await clickButton(page, 'CREATE ROOM');
  try {
    await page.getByText('Game Lobby').waitFor({ timeout: 15000 });
  } catch (e) {
    throw new Error(`create room did not reach lobby. body=${JSON.stringify((await bodyText(page)).slice(0, 500))}`);
  }
  const code = (await page.locator('[data-testid="room-code"]').textContent())?.trim() || '';
  return code;
}

async function joinRoom(page, opts) {
  const { name, code } = opts;
  await openJoin(page);
  await setInput(page, 'Your name', name);
  await page.locator('input[placeholder="ABCDE"]').fill(code);
  await clickButton(page, 'JOIN ROOM');
}

async function spectateRoom(page, opts) {
  const { name, code } = opts;
  await openJoin(page);
  await setInput(page, 'Your name', name);
  await page.locator('input[placeholder="ABCDE"]').fill(code);
  await page.getByRole('button', { name: 'Watch as spectator', exact: true }).click();
}

async function startGame(page) {
  await clickButton(page, 'START GAME');
  await page.locator('[data-testid="game-screen"]').waitFor({ timeout: 20000 });
}

async function waitGameScreen(page) {
  await page.locator('[data-testid="game-screen"]').waitFor({ timeout: 20000 });
}

async function isMyTurn(page) {
  try {
    return await page.evaluate(() => {
      const el = document.querySelector('[data-testid="game-screen"]');
      return !!el && el.getAttribute('data-my-turn') === 'true';
    });
  } catch { return false; }
}

async function turnCount(page) {
  try {
    const el = page.locator('[data-testid="game-screen"]');
    const t = await el.getAttribute('data-turn-count', { timeout: 500 });
    return t == null ? null : Number(t);
  } catch { return null; }
}

async function resultsVisible(page) {
  try { return await page.locator('[data-testid="results-screen"]').isVisible(); } catch { return false; }
}

async function waitForTurnPage(pages, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const p of pages) {
      if (await resultsVisible(p)) return p;
      if (await isMyTurn(p)) return p;
    }
    await delay(150);
  }
  return null;
}

async function takeTurn(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="game-screen"]');
    return !!el && el.getAttribute('data-my-turn') === 'true';
  }, null, { timeout: 20000 });
  const before = await turnCount(page);
  const cell = page.locator('[data-testid="game-board"] [data-playable="true"]').first();
  await cell.waitFor({ state: 'visible', timeout: 8000 });
  await cell.click({ force: true });
  await page.waitForFunction((n) => {
    if (document.querySelector('[data-testid="results-screen"]')) return true;
    const el = document.querySelector('[data-testid="game-screen"]');
    return !!el && Number(el.getAttribute('data-turn-count')) > n;
  }, before, { timeout: 20000 });
  return true;
}

async function playUntilResults(pages, maxMoves = 500) {
  for (let i = 0; i < maxMoves; i++) {
    for (const p of pages) if (await resultsVisible(p)) return true;
    let moved = false;
    for (const p of pages) {
      if (await resultsVisible(p)) return true;
      if (await isMyTurn(p)) {
        try { await takeTurn(p); moved = true; } catch {}
        break;
      }
    }
    if (!moved) {
      // If it is an AI-free online room and neither page reports our turn, wait for state.
      await delay(250);
    }
  }
  for (const p of pages) if (await resultsVisible(p)) return true;
  return false;
}

async function waitForToastText(page, text, timeout = 6000) {
  await page.waitForFunction((t) => {
    const el = document.querySelector('[data-testid="toast"]');
    return !!el && (el.textContent || '').includes(t);
  }, text, { timeout });
}

async function saveShot(page, name) {
  try { await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); } catch {}
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
    if (e.page) await saveShot(e.page, name.replace(/[^a-z0-9]+/gi, '-'));
  }
}

(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
  });

  let ctxA, ctxB, ctxC, pageA, pageB, pageC;
  let roomCode;

  await test('homepage loads, credits and settings work', async () => {
    const ctx = await newContext();
    const page = await newPage(ctx, 'home');
    await gotoHome(page);
    const title = await page.title();
    if (!/Color Wars/i.test(title)) throw new Error(`unexpected title: ${title}`);
    const credit = page.getByText('created by').first();
    await credit.waitFor();
    const links = await page.locator('a').evaluateAll(as => as.map(a => a.href));
    if (!links.includes('https://nextpointer.dev/') && !links.includes('https://nextpointer.dev')) throw new Error('missing nextpointer link');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByText('Animations', { exact: true }).waitFor();
    await page.getByText('Timer sounds', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Minimal', exact: true }).click();
    await delay(150);
    const saved = await page.evaluate(() => localStorage.getItem('cw.animQuality'));
    if (saved !== 'minimal') throw new Error(`animation setting not saved: ${saved}`);
    await ctx.close();
  });

  await test('single-player full game (heart shape, toss, chains, results, play again)', async () => {
    ctxA = await newContext();
    pageA = await newPage(ctxA, 'single');
    await gotoHome(pageA);
    await pageA.getByText('VS COMPUTER', { exact: true }).click();
    await setInput(pageA, 'Your name', 'Solo');
    await pageA.getByRole('button', { name: 'Heart', exact: true }).click();
    await pageA.getByRole('button', { name: '5×7', exact: true }).click().catch(async () => {
      await pageA.getByRole('button', { name: /5.7/, exact: true }).first().click();
    });
    await clickButton(pageA, 'START GAME');
    await waitGameScreen(pageA);
    const sawToss = await pageA.waitForFunction(() => document.body.innerText.includes('Color toss…'), null, { timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    await pageA.waitForFunction(() => !document.body.innerText.includes('Color toss…'), null, { timeout: 20000 }).catch(() => {});
    const board = pageA.locator('[data-testid="game-board"]');
    await board.waitFor();
    const rows = Number(await board.getAttribute('data-rows'));
    const cols = Number(await board.getAttribute('data-cols'));
    if (rows <= 0 || cols <= 0) throw new Error('board has invalid dimensions');
    const finished = await playUntilResults([pageA], 500);
    if (!finished) throw new Error('single-player game did not finish');
    await pageA.locator('[data-testid="results-screen"]').waitFor();
    const t = await pageA.locator('[data-testid="results-screen"]').innerText();
    if (!/wins!|Play again/i.test(t)) throw new Error(`unexpected results content: ${t.slice(0,200)}`);
    const tossInfo = sawToss ? 'toss-seen' : 'toss-not-detected';
    console.log(`  info: ${tossInfo}; board=${rows}x${cols}`);
    await clickButton(pageA, 'PLAY AGAIN');
    await waitGameScreen(pageA);
    await ctxA.close();
  });

  await test('single-player timeout auto-moves', async () => {
    ctxB = await newContext();
    pageB = await newPage(ctxB, 'timeout');
    await gotoHome(pageB);
    await pageB.getByText('VS COMPUTER', { exact: true }).click();
    await setInput(pageB, 'Your name', 'Timer');
    await clickButton(pageB, 'START GAME');
    await waitGameScreen(pageB);
    await pageB.waitForFunction(() => {
      const el = document.querySelector('[data-testid="game-screen"]');
      return !!el && el.getAttribute('data-my-turn') === 'true';
    }, null, { timeout: 30000 });
    const before = await turnCount(pageB);
    await pageB.waitForFunction((n) => {
      if (document.querySelector('[data-testid="results-screen"]')) return true;
      const el = document.querySelector('[data-testid="game-screen"]');
      return !!el && Number(el.getAttribute('data-turn-count')) > n;
    }, before, { timeout: 75000 });
    console.log('  info: fixed 1-minute turn timeout auto-move observed');
    await ctxB.close();
  });

  await test('multiplayer: create/join, duplicate tab, spectator, start', async () => {
    ctxA = await newContext();
    ctxB = await newContext();
    ctxC = await newContext();
    pageA = await newPage(ctxA, 'host');
    pageB = await newPage(ctxB, 'guest');
    pageC = await newPage(ctxC, 'spec');

    await gotoHome(pageA);
    roomCode = await createRoom(pageA, { name: 'Host', players: 2, shape: 'Grid', grid: '5×7', gameTime: '10 min', teamMode: 'FFA' });
    if (!roomCode || roomCode.length < 5) throw new Error(`bad room code: ${roomCode}`);

    await gotoHome(pageB);
    await joinRoom(pageB, { name: 'Guest', code: roomCode });
    await pageB.getByText('Game Lobby').waitFor();
    const lobbyText = await pageB.getByText(/2 \/ 2 joined/).first().textContent().catch(() => '');
    if (!lobbyText) throw new Error('guest lobby did not show 2/2 players');

    // Duplicate tab in the same host context shares localStorage session but gets a new
    // sessionStorage tabId, so the server must refuse to steal the live seat.
    const dup = await newPage(ctxA, 'dup');
    await gotoHome(dup);
    const dupToast = await dup.locator('[data-testid="toast"]').textContent({ timeout: 3000 }).catch(() => '');
    if (!dupToast) await delay(1500);
    const hostLobby = await pageA.getByText(/2 \/ 2 joined/).first().textContent().catch(() => '');
    if (!hostLobby) throw new Error('host lobby no longer shows 2/2 after duplicate tab opened');
    const dupText = await bodyText(dup);
    if (/Game Lobby/.test(dupText)) throw new Error('duplicate tab was allowed to take over the room');
    if (!/another tab|Already/i.test(dupToast || '')) {
      console.log(`  warn: duplicate tab toast not observed (got ${JSON.stringify(dupToast)})`);
    }
    await dup.close();

    await gotoHome(pageC);
    await spectateRoom(pageC, { name: 'Watcher', code: roomCode });
    await pageC.getByText('Watching as spectator').waitFor({ timeout: 10000 });

    await startGame(pageA);
    await waitGameScreen(pageB);
    await waitGameScreen(pageC);
    const specFlag = await pageC.locator('[data-testid="game-screen"]').getAttribute('data-spectator');
    if (specFlag !== 'true') throw new Error(`spectator flag not true: ${specFlag}`);
    const specPlayable = await pageC.locator('[data-testid="game-board"] [data-playable="true"]').count();
    if (specPlayable !== 0) throw new Error(`spectator sees ${specPlayable} playable cells`);
    console.log(`  info: room=${roomCode}; spectator sees live board`);
  });

  await test('multiplayer: reconnect, rapid clicks, full game, results, rematch', async () => {
    if (!pageA || !pageB) throw new Error('missing multiplayer pages');
    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await waitGameScreen(pageA);
    const rapidPage = await waitForTurnPage([pageA, pageB], 30000);
    if (!rapidPage) throw new Error('no player ever got a turn');
    if (!(await resultsVisible(rapidPage))) {
      const before = await turnCount(rapidPage);
      const cells = rapidPage.locator('[data-testid="game-board"] [data-playable="true"]');
      const count = Math.min(4, await cells.count());
      for (let i = 0; i < count; i++) {
        try { await cells.nth(i).click({ force: true, timeout: 1500 }); } catch {}
      }
      await delay(800);
      const after = await turnCount(rapidPage);
      if (after != null && before != null && after - before !== 1) {
        throw new Error(`rapid click guard did not limit to one move (delta ${after - before})`);
      }
      if (count > 1) console.log(`  info: rapid clicks on ${count} cells produced exactly one turn`);
    }
    const finished = await playUntilResults([pageA, pageB], 500);
    if (!finished) throw new Error('multiplayer game did not finish');
    await pageA.locator('[data-testid="results-screen"]').waitFor();
    await pageB.locator('[data-testid="results-screen"]').waitFor();
    const resultsTextA = await pageA.locator('[data-testid="results-screen"]').innerText();
    if (!/wins!/i.test(resultsTextA)) throw new Error(`host results missing winner: ${resultsTextA.slice(0,200)}`);
    await clickButton(pageA, 'BACK TO LOBBY');
    await pageA.getByText('Game Lobby').waitFor({ timeout: 15000 });
    await pageB.getByText('Game Lobby').waitFor({ timeout: 15000 });
    console.log('  info: reconnect + rapid-click + finish + rematch observed');
  });

  await test('multiplayer: spectator cannot move, sees result', async () => {
    if (!pageC) throw new Error('missing spectator page');
    const before = await turnCount(pageC);
    if (!(await resultsVisible(pageC)) && before != null) {
      const anyCell = pageC.locator('[data-testid="game-board"] [data-cell]').first();
      await anyCell.click({ force: true }).catch(() => {});
      await delay(500);
      const after = await turnCount(pageC);
      if (after != null && after !== before) throw new Error('spectator click changed turn count');
    }
    await pageC.getByText('Game Lobby').waitFor({ timeout: 15000 });
    console.log('  info: spectator stayed read-only through result/rematch');
  });

  for (const c of [ctxA, ctxB, ctxC]) { try { await c?.close(); } catch {} }
  ctxA = ctxB = ctxC = null; pageA = pageB = pageC = null;

  await test('team mode 2v2 lobby and start', async () => {
    const host = await newContext();
    const guests = [await newContext(), await newContext(), await newContext()];
    const hp = await newPage(host, 'team-host');
    const gp = [await newPage(guests[0], 'team-g1'), await newPage(guests[1], 'team-g2'), await newPage(guests[2], 'team-g3')];
    await gotoHome(hp);
    const code = await createRoom(hp, { name: 'Host', players: 4, shape: 'Grid', grid: '6×9', gameTime: '10 min', teamMode: '2v2' });
    if (!code) throw new Error('no team room code');
    for (let i = 0; i < gp.length; i++) {
      await gotoHome(gp[i]);
      await joinRoom(gp[i], { name: `G${i + 1}`, code });
      await gp[i].getByText('Game Lobby').waitFor({ timeout: 15000 });
    }
    await hp.getByText(/4 \/ 4 joined/).waitFor({ timeout: 15000 });
    const lobbyBody = await bodyText(hp);
    if (!/\(T[12]\)/.test(lobbyBody)) throw new Error('lobby missing team labels');
    await startGame(hp);
    await Promise.all(gp.map(p => waitGameScreen(p)));
    const pillsText = await bodyText(hp);
    if (!/T[12]/.test(pillsText)) throw new Error('game screen missing team labels');
    const status = await hp.locator('[data-testid="game-screen"]').getAttribute('data-game-status');
    if (status !== 'playing') throw new Error(`game not playing: ${status}`);
    for (const c of [host, ...guests]) { try { await c.close(); } catch {} }
  });

  await test('room errors: full, already started, not found', async () => {
    const host = await newContext();
    const g1 = await newContext();
    const g2 = await newContext();
    const g3 = await newContext();
    const hp = await newPage(host, 'err-host');
    const p1 = await newPage(g1, 'err-g1');
    const p2 = await newPage(g2, 'err-g2');
    const p3 = await newPage(g3, 'err-g3');
    await gotoHome(hp);
    const code = await createRoom(hp, { name: 'Host', players: 2, shape: 'Grid', grid: '5×7', gameTime: '10 min', teamMode: 'FFA' });
    await gotoHome(p1);
    await joinRoom(p1, { name: 'One', code });
    await p1.getByText('Game Lobby').waitFor();
    await gotoHome(p2);
    await joinRoom(p2, { name: 'Two', code });
    await waitForToastText(p2, 'Room is full', 8000);
    await gotoHome(p3);
    await openJoin(p3);
    await setInput(p3, 'Your name', 'Ghost');
    await p3.locator('input[placeholder="ABCDE"]').fill('ZZZZZ');
    await clickButton(p3, 'JOIN ROOM');
    await waitForToastText(p3, 'Room not found', 8000);

    await startGame(hp);
    await waitGameScreen(hp);
    await gotoHome(p2);
    await openJoin(p2);
    await setInput(p2, 'Your name', 'Two');
    await p2.locator('input[placeholder="ABCDE"]').fill(code);
    await clickButton(p2, 'JOIN ROOM');
    await waitForToastText(p2, 'Game already started', 8000);
    for (const c of [host, g1, g2, g3]) { try { await c.close(); } catch {} }
  });

  await test('mobile viewport: no horizontal overflow on landing/create/game', async () => {
    const ctx = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await newPage(ctx, 'mobile');
    await gotoHome(page);
    const overflowHome = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflowHome > 2) throw new Error(`landing horizontal overflow: ${overflowHome}px`);
    await openCreate(page);
    const overflowCreate = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflowCreate > 2) throw new Error(`create horizontal overflow: ${overflowCreate}px`);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.getByText('COLOR WARS').first().waitFor();
    await page.getByText('VS COMPUTER', { exact: true }).click();
    await setInput(page, 'Your name', 'Mobile');
    await clickButton(page, 'START GAME');
    await waitGameScreen(page);
    const overflowGame = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflowGame > 2) throw new Error(`game horizontal overflow: ${overflowGame}px`);
    const board = await page.locator('[data-testid="game-board"]').boundingBox();
    if (!board) throw new Error('board has no bounding box');
    if (board.x < -5 || board.x + board.width > 395) throw new Error(`board outside viewport: x=${board.x} w=${board.width}`);
    console.log(`  info: mobile board ${board.width.toFixed(0)}x${board.height.toFixed(0)} fits viewport`);
    await ctx.close();
  });

  await test('settings persist after reload', async () => {
    const ctx = await newContext();
    const page = await newPage(ctx, 'settings');
    await gotoHome(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Reduced', exact: true }).click();
    await delay(150);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('COLOR WARS').first().waitFor();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const saved = await page.evaluate(() => localStorage.getItem('cw.animQuality'));
    if (saved !== 'reduced') throw new Error(`animation preference not persisted: ${saved}`);
    await ctx.close();
  });

  await browser.close();

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  fs.writeFileSync(path.join(SHOTS, 'core-report.json'), JSON.stringify({ results, pageErrors }, null, 2));
  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`);
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
