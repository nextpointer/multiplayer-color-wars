import {
  applyMove,
  createGame,
  criticalMass,
  finishGameByTime,
  gameDurationMsFor,
  getValidMoves,
  isGameTimeExpired,
  isPlayable,
  isValidTeamModeForPlayers,
  normalizeGameTimeMinutes,
  removePlayerCells,
  turnDurationMsFor,
  FIXED_TURN_MS,
  type GameState,
} from '../shared/src/index.ts';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`PASS - ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${(e as Error).message}`);
    console.log(`FAIL - ${name} :: ${(e as Error).message}`);
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function twoPlayer(rows = 5, cols = 5, opts: Parameters<typeof createGame>[3] = {}): GameState {
  const state = createGame([{ name: 'A' }, { name: 'B' }], rows, cols, opts);
  state.currentPlayerIndex = 0;
  return state;
}

check('opening-round protection: first moves must be on empty cells', () => {
  const state = twoPlayer();
  const first = applyMove(state, 0, 2, 2);
  assert(first.ok && first.state, `first move failed: ${first.error}`);
  assert(first.state.players[0].hasPlayed, 'first player should be marked as played');

  const occupied = applyMove(first.state, 1, 2, 2);
  assert(!occupied.ok, 'second player should not be allowed to place on an occupied cell');
  assert(/empty cell/i.test(occupied.error || ''), `unexpected error: ${occupied.error}`);

  const second = applyMove(first.state, 1, 2, 3);
  assert(second.ok && second.state, `second player first move failed: ${second.error}`);
  assert(second.state.players.every(p => p.hasPlayed), 'all players should have played');

  const otherCell = applyMove(second.state, 0, 2, 3);
  assert(!otherCell.ok, 'players may not increment another player’s cell after the opening round');
  const ownCell = applyMove(second.state, 0, 2, 2);
  assert(ownCell.ok, `owner should be able to increment their own cell: ${ownCell.error}`);
});

check('opening placement: starts with 3 dots everywhere', () => {
  const state = twoPlayer(5, 7);

  const corner = applyMove(state, 0, 0, 0);
  assert(corner.ok && corner.state, `corner start failed: ${corner.error}`);
  // Corner critical mass is 2, so starting with 3 dots explodes immediately.
  assert((corner.explosions || []).length > 0, 'corner start with 3 dots should explode');
  assert(corner.state.status === 'playing', `corner opening explosion should not end the game, got ${corner.state.status}`);
  assert(corner.state.players[0].alive, 'player should remain alive after their own opening explosion');
  const cornerOwned = corner.state.board.flat().filter(cell => cell.owner === 0).length;
  assert(cornerOwned > 0, 'player should still own cells after corner opening explosion');

  const edgeState = twoPlayer(5, 7);
  edgeState.currentPlayerIndex = 0;
  const edge = applyMove(edgeState, 0, 0, 3); // top edge, critical mass 3
  assert(edge.ok && edge.state, `edge start failed: ${edge.error}`);
  assert((edge.explosions || []).length > 0, 'edge start with 3 dots should explode at critical mass');
  assert(edge.state.players[0].alive, 'player should remain alive after edge opening explosion');

  const interiorState = twoPlayer(5, 7);
  interiorState.currentPlayerIndex = 0;
  const interior = applyMove(interiorState, 0, 2, 3);
  assert(interior.ok && interior.state, `interior start failed: ${interior.error}`);
  assert(interior.state.board[2][3].owner === 0 && interior.state.board[2][3].count === 3, 'interior start should place 3 dots');
  assert((interior.explosions || []).length === 0, 'interior start below critical mass should not explode');

  for (const s of [corner.state, edge.state, interior.state]) {
    for (let r = 0; r < s.rows; r++) {
      for (let c = 0; c < s.cols; c++) {
        if (!isPlayable(s, r, c) || s.board[r][c].owner == null) continue;
        assert(s.board[r][c].count < criticalMass(s.rows, s.cols, r, c, s.mask), `cell ${r},${c} is unstable after opening`);
      }
    }
  }
});

check('chain resolution: burst captures orthogonal neighbours and stabilises', () => {
  const state = twoPlayer(3, 3);
  state.players.forEach(p => { p.hasPlayed = true; });
  state.currentPlayerIndex = 0;
  state.board[1][1] = { owner: 0, count: 3 };
  const result = applyMove(state, 0, 1, 1);
  assert(result.ok && result.state, `move failed: ${result.error}`);
  const s = result.state;
  assert(result.explosions?.length === 1, `expected one explosion, got ${result.explosions?.length}`);
  assert(s.board[1][1].owner === null && s.board[1][1].count === 0, 'center should be empty after bursting');
  for (const [r, c] of [[0, 1], [2, 1], [1, 0], [1, 2]]) {
    assert(s.board[r][c].owner === 0 && s.board[r][c].count === 1, `neighbour ${r},${c} should be captured`);
  }
  for (let r = 0; r < s.rows; r++) {
    for (let c = 0; c < s.cols; c++) {
      if (!isPlayable(s, r, c) || s.board[r][c].owner == null) continue;
      assert(s.board[r][c].count < criticalMass(s.rows, s.cols, r, c, s.mask), `cell ${r},${c} is still unstable`);
    }
  }
});

check('board masks: trimmed cells are unplayable and critical mass is mask-aware', () => {
  const state = createGame([{ name: 'A' }, { name: 'B' }], 6, 9, { shape: 'heart' });
  assert(state.mask, 'heart board should have a mask');
  let playable = 0;
  let reducedEdge = false;
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (!isPlayable(state, r, c)) continue;
      playable++;
      const crit = criticalMass(state.rows, state.cols, r, c, state.mask);
      assert(crit >= 1 && crit <= 4, `invalid critical mass ${crit} at ${r},${c}`);
      if (crit < 3) reducedEdge = true;
    }
  }
  assert(playable > 0 && playable < state.rows * state.cols, `unexpected playable count ${playable}`);
  assert(reducedEdge, 'masked board should have reduced-degree edge cells');
  assert(!isPlayable(state, 0, 0), 'masked corner should be unplayable');
  const square = createGame([{ name: 'A' }, { name: 'B' }], 6, 9, { shape: 'square' });
  assert(square.rows === 9 && square.cols === 9 && !square.mask, 'square shape should produce a full square board');
});

check('team assignment and required player counts', () => {
  const four = createGame([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }], 9, 9, { teamMode: '2v2' });
  assert(four.teamMode === '2v2' && four.teamsCount === 2, '2v2 metadata missing');
  assert(JSON.stringify(four.players.map(p => p.team)) === JSON.stringify([0, 1, 0, 1]), '2v2 teams should be interleaved');
  assert(isValidTeamModeForPlayers('2v2', 4), '2v2 should be valid with 4');
  assert(!isValidTeamModeForPlayers('2v2', 3), '2v2 should be invalid with 3');

  const six = createGame([1, 2, 3, 4, 5, 6].map(i => ({ name: `P${i}` })), 9, 9, { teamMode: '3v3' });
  assert(JSON.stringify(six.players.map(p => p.team)) === JSON.stringify([0, 1, 0, 1, 0, 1]), '3v3 teams should be interleaved');
  assert(isValidTeamModeForPlayers('3v3', 6), '3v3 should be valid with 6');
  assert(!isValidTeamModeForPlayers('3v3', 5), '3v3 should be invalid with 5');

  const partial = createGame([{ name: 'A' }, { name: 'B' }, { name: 'C' }], 9, 9, { teamMode: '2v2' });
  assert(partial.teamMode === '2v2', 'partial lobby should preserve intended team mode');
  assert(partial.players.some(p => typeof p.team === 'number'), 'partial lobby should still assign teams');

  const ffa = createGame([{ name: 'A' }, { name: 'B' }], 5, 7, { teamMode: 'ffa' });
  assert(ffa.teamMode === 'off', 'ffa should normalise to off');
});

check('overall game timer and fixed 1-minute turns', () => {
  assert(turnDurationMsFor() === FIXED_TURN_MS, 'turn duration should be fixed to 60s');
  assert(turnDurationMsFor(10, 2) === FIXED_TURN_MS, 'turn duration should be fixed regardless of inputs');
  assert(normalizeGameTimeMinutes(10) === 10 && normalizeGameTimeMinutes(20) === 20 && normalizeGameTimeMinutes(30) === 30, 'valid game times should normalise');
  assert(normalizeGameTimeMinutes('20') === 20, 'string game time should normalise');
  assert(normalizeGameTimeMinutes(999) === 10, 'invalid game time should default to 10');
  assert(gameDurationMsFor(10) === 10 * 60_000, '10 minute duration');
  assert(gameDurationMsFor(20) === 20 * 60_000, '20 minute duration');
  assert(gameDurationMsFor(30) === 30 * 60_000, '30 minute duration');
  const state = createGame([{ name: 'A' }, { name: 'B' }], 5, 7, { gameTimeMinutes: 20 });
  assert(state.gameTimeMinutes === 20, 'game should carry overall timer selection');
  assert(state.gameDurationMs === 20 * 60_000, 'game should carry overall duration');
  assert(state.turnDurationMs === FIXED_TURN_MS, 'game should use fixed 1-minute turns');
});

check('game time expiry finishes by most orbs/cells', () => {
  const state = twoPlayer(3, 3, { gameTimeMinutes: 10 });
  state.players.forEach(p => { p.hasPlayed = true; });
  state.board[0][0] = { owner: 0, count: 3 };
  state.board[0][1] = { owner: 0, count: 1 };
  state.board[1][0] = { owner: 1, count: 2 };
  state.gameDeadline = Date.now() - 1;
  assert(isGameTimeExpired(state), 'expired game should be detected');
  assert(getValidMoves(state, 0).length === 0, 'no moves allowed after game time expiry');
  const move = applyMove(state, 0, 2, 2);
  assert(!move.ok && /time expired/i.test(move.error || ''), 'applyMove should reject expired game');
  assert(move.state?.status === 'finished', 'expired move should produce finished state');
  const finished = finishGameByTime(state);
  assert(finished.status === 'finished', 'finishGameByTime should finish the game');
  assert(finished.winner === 0, 'player with more orbs should win on time');
  assert(finished.turnDeadline === null, 'finished game should clear turn deadline');
});

check('team elimination: last surviving team wins', () => {
  const state = createGame([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }], 7, 7, { teamMode: '2v2' });
  state.players.forEach(p => { p.hasPlayed = true; });
  state.currentPlayerIndex = 0;
  state.board[0][0] = { owner: 0, count: 1 };
  state.board[0][1] = { owner: 2, count: 1 };
  const next = removePlayerCells(state, 1);
  assert(next.status === 'finished', `game should finish, got ${next.status}`);
  const winner = next.players.find(p => p.id === next.winner);
  assert(winner?.team === 0, 'winning representative should belong to team 0');
  assert(next.players.filter(p => p.alive).every(p => p.team === 0), 'only team 0 should remain alive');
});

check('long chain stress: high counts resolve to a stable bounded state', () => {
  const state = twoPlayer(3, 3);
  state.players.forEach(p => { p.hasPlayed = true; });
  state.currentPlayerIndex = 0;
  state.board[1][1] = { owner: 0, count: 500 };
  const started = Date.now();
  const result = applyMove(state, 0, 1, 1);
  const elapsed = Date.now() - started;
  assert(result.ok && result.state, `stress move failed: ${result.error}`);
  assert(elapsed < 5000, `chain resolution took too long: ${elapsed}ms`);
  for (let r = 0; r < result.state.rows; r++) {
    for (let c = 0; c < result.state.cols; c++) {
      if (!isPlayable(result.state, r, c) || result.state.board[r][c].owner == null) continue;
      assert(result.state.board[r][c].count < criticalMass(result.state.rows, result.state.cols, r, c, result.state.mask), `cell ${r},${c} unstable after stress`);
    }
  }
});

check('move validation: turn, bounds, mask, and finished state', () => {
  const state = twoPlayer(5, 7);
  const notYourTurn = applyMove(state, 1, 0, 0);
  assert(!notYourTurn.ok && /not your turn/i.test(notYourTurn.error || ''), 'out-of-turn move should be rejected');
  const outOfBounds = applyMove(state, 0, -1, 0);
  assert(!outOfBounds.ok && /out of bounds/i.test(outOfBounds.error || ''), 'out-of-bounds move should be rejected');

  const heart = createGame([{ name: 'A' }, { name: 'B' }], 6, 9, { shape: 'heart' });
  heart.currentPlayerIndex = 0;
  const masked = applyMove(heart, 0, 0, 0);
  assert(!masked.ok && /not available/i.test(masked.error || ''), 'masked cell should be rejected');

  const finished = twoPlayer();
  finished.status = 'finished';
  const afterFinish = applyMove(finished, 0, 0, 0);
  assert(!afterFinish.ok && /not in progress/i.test(afterFinish.error || ''), 'finished game should reject moves');
});

console.log(`\nSHARED SUMMARY: ${passed} passed, ${failed} failed`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failed ? 1 : 0);
