import { useEffect, useMemo, useRef, useState } from 'react';
import { criticalMass, type GameState } from '@game/shared';

type ServerMsg =
  | { type: 'room'; roomId: string; playerId: number; players: { id: number; name: string; color: string }[]; hostId: number; state: GameState }
  | { type: 'state'; state: GameState; explosions?: { r: number; c: number; owner: number }[] }
  | { type: 'error'; message: string };

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = import.meta.env.VITE_WS_URL || `${proto}//${location.hostname}:3001`;
  return host.endsWith('/ws') ? host : `${host.replace(/\/$/, '')}/ws`;
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [hostId, setHostId] = useState<number | null>(null);
  const [lobbyPlayers, setLobbyPlayers] = useState<{ id: number; name: string; color: string }[]>([]);
  const [state, setState] = useState<GameState | null>(null);
  const [burstKey, setBurstKey] = useState(0);
  const [burstCells, setBurstCells] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;
    ws.onopen = () => { setConnected(true); setError(null); };
    ws.onclose = () => { setConnected(false); };
    ws.onerror = () => { setError('Connection error. Is the server running?'); };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'error') { setError(msg.message); setTimeout(() => setError(null), 3500); return; }
      if (msg.type === 'room') {
        setRoomId(msg.roomId);
        setPlayerId(msg.playerId);
        setHostId(msg.hostId);
        setLobbyPlayers(msg.players);
        setState(msg.state);
        setError(null);
        return;
      }
      if (msg.type === 'state') {
        setState(msg.state);
        if (msg.explosions && msg.explosions.length) {
          setBurstCells(new Set(msg.explosions.map(e => `${e.r},${e.c}`)));
          setBurstKey(k => k + 1);
          setTimeout(() => setBurstCells(new Set()), 350);
        }
        return;
      }
    };
    return () => ws.close();
  }, []);

  function send(obj: any) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  const myTurn = !!state && state.status === 'playing' && playerId != null && state.players[state.currentPlayerIndex]?.id === playerId;
  const me = state?.players.find(p => p.id === playerId);

  if (!roomId || !state || playerId == null) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-indigo-100 text-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950 dark:text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md animate-fade-in">
          <div className="bg-white/80 dark:bg-slate-900/70 backdrop-blur rounded-2xl shadow-xl border border-slate-200/70 dark:border-slate-700/60 p-6 sm:p-8">
            <div className="flex items-center justify-between mb-2">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Color Wars</h1>
              <span className={`text-xs px-2 py-1 rounded-full ${connected ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}`}>
                {connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">Chain Reaction multiplayer · 2–8 players · standard rules</p>
            <label className="block text-sm font-medium mb-1">Your name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Enter a name" maxLength={20}
              className="w-full mb-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500" />
            <button onClick={() => send({ type: 'create', name: name || 'Player' })} disabled={!connected}
              className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-2.5 transition shadow-lg shadow-indigo-600/20">Create Game</button>
            <div className="flex items-center gap-3 my-4 text-xs text-slate-500"><div className="h-px flex-1 bg-slate-300 dark:bg-slate-700" />or join<div className="h-px flex-1 bg-slate-300 dark:bg-slate-700" /></div>
            <div className="flex gap-2">
              <input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="ROOM CODE" maxLength={6}
                className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 uppercase tracking-widest outline-none focus:ring-2 focus:ring-indigo-500" />
              <button onClick={() => send({ type: 'join', roomId: joinCode, name: name || 'Player' })} disabled={!connected || !joinCode.trim()}
                className="rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 text-white font-semibold px-4 transition">Join</button>
            </div>
            {error && <div className="mt-4 text-sm rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 px-3 py-2 animate-slide-up">{error}</div>}
          </div>
          <ul className="mt-4 text-xs text-slate-600 dark:text-slate-400 space-y-1 px-1">
            <li>• Place an orb in an empty cell or one you own.</li>
            <li>• Critical mass: corners 2, edges 3, middle 4 — then it explodes to neighbors and captures them.</li>
            <li>• Chain reactions happen automatically. Last player with orbs wins.</li>
          </ul>
        </div>
      </div>
    );
  }

  if (state.status === 'waiting') {
    const isHost = hostId === playerId;
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-indigo-100 text-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950 dark:text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white/80 dark:bg-slate-900/70 backdrop-blur rounded-2xl shadow-xl border border-slate-200/70 dark:border-slate-700/60 p-6 sm:p-8 animate-fade-in">
          <h2 className="text-xl font-bold mb-1">Waiting Room</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">Share this code with friends (up to 8 players)</p>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-3 text-center text-2xl font-mono tracking-[0.3em] font-bold">{roomId}</div>
            <button onClick={() => navigator.clipboard.writeText(roomId)} className="rounded-xl px-3 py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition">Copy</button>
          </div>
          <div className="space-y-2 mb-6">
            {lobbyPlayers.map(p => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 bg-white/60 dark:bg-slate-800/40">
                <span className="h-3.5 w-3.5 rounded-full shadow" style={{ background: p.color }} />
                <span className="font-medium flex-1">{p.name}{p.id === playerId ? ' (you)' : ''}</span>
                {p.id === hostId && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Host</span>}
              </div>
            ))}
          </div>
          {isHost ? (
            <button onClick={() => send({ type: 'start' })} disabled={lobbyPlayers.length < 2}
              className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2.5 transition shadow-lg shadow-emerald-600/20">
              {lobbyPlayers.length < 2 ? 'Need at least 2 players' : `Start Game (${lobbyPlayers.length} players)`}
            </button>
          ) : (
            <div className="text-center text-sm text-slate-600 dark:text-slate-400 py-2">Waiting for host to start…</div>
          )}
          {error && <div className="mt-4 text-sm rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 px-3 py-2">{error}</div>}
        </div>
      </div>
    );
  }

  const current = state.players[state.currentPlayerIndex];
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-indigo-100 text-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950 dark:text-slate-100 p-3 sm:p-5">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h1 className="text-lg sm:text-xl font-bold">Color Wars <span className="text-slate-400 font-normal text-sm ml-1">#{roomId}</span></h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              {state.status === 'finished' ? `Game over` : myTurn ? "Your turn — tap a glowing cell" : `${current?.name}'s turn`}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-1 rounded-full bg-slate-200/70 dark:bg-slate-800">{state.rows}×{state.cols}</span>
            <span className="px-2 py-1 rounded-full bg-slate-200/70 dark:bg-slate-800">{state.players.length} players</span>
          </div>
        </div>
        {error && <div className="mb-3 text-sm rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 px-3 py-2 animate-slide-up">{error}</div>}

        <div className="grid lg:grid-cols-[220px_1fr_220px] gap-3 sm:gap-4 items-start">
          <div className="space-y-2 order-2 lg:order-1">
            {state.players.slice(0, Math.ceil(state.players.length / 2)).map(p => <PlayerCard key={p.id} p={p} active={p.id === current?.id} me={p.id === playerId} state={state} />)}
          </div>

          <div className="order-1 lg:order-2 flex justify-center">
            <Board state={state} myId={playerId} myTurn={myTurn} burstCells={burstCells} burstKey={burstKey} onMove={(r,c) => send({ type: 'move', r, c })} />
          </div>

          <div className="space-y-2 order-3">
            {state.players.slice(Math.ceil(state.players.length / 2)).map(p => <PlayerCard key={p.id} p={p} active={p.id === current?.id} me={p.id === playerId} state={state} />)}
          </div>
        </div>

        {state.status === 'finished' && (
          <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-20 animate-fade-in">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6 sm:p-8 w-full max-w-sm text-center animate-slide-up">
              <div className="text-sm uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Winner</div>
              <div className="text-3xl font-extrabold mb-1" style={{ color: state.players.find(p => p.id === state.winner)?.color }}>
                {state.players.find(p => p.id === state.winner)?.name || 'Nobody'}
              </div>
              <p className="text-slate-600 dark:text-slate-400 mb-6">dominates the board!</p>
              {hostId === playerId ? (
                <button onClick={() => send({ type: 'rematch' })} className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 transition">Rematch</button>
              ) : (
                <div className="text-sm text-slate-500">Waiting for host to start a rematch…</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function orbTotal(state: GameState, pid: number) {
  let n = 0;
  for (const row of state.board) for (const cell of row) if (cell.owner === pid) n += cell.count;
  return n;
}

function PlayerCard({ p, active, me, state }: { p: any; active: boolean; me: boolean; state: GameState }) {
  const total = orbTotal(state, p.id);
  return (
    <div className={`rounded-xl border px-3 py-2.5 flex items-center gap-3 transition cell-transition ${active ? 'ring-2 shadow-lg' : ''} ${!p.alive ? 'opacity-45 grayscale' : ''} bg-white/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700`}
      style={active ? { ['--tw-ring-color' as any]: p.color, boxShadow: `0 0 0 2px ${p.color}33, 0 10px 20px -10px ${p.color}66` } : undefined}>
      <span className="h-4 w-4 rounded-full shadow-inner flex-shrink-0" style={{ background: p.color }} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate text-sm">{p.name}{me ? ' (you)' : ''}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{!p.alive ? 'Eliminated' : `${total} orbs`}</div>
      </div>
      {active && p.alive && <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: p.color }}>Turn</span>}
    </div>
  );
}

function Board({ state, myId, myTurn, burstCells, burstKey, onMove }: { state: GameState; myId: number; myTurn: boolean; burstCells: Set<string>; burstKey: number; onMove: (r:number,c:number)=>void }) {
  const maxDim = Math.max(state.rows, state.cols);
  const size = maxDim <= 9 ? 'min(2.6rem, 9vw)' : maxDim <= 12 ? 'min(2.2rem, 7.5vw)' : 'min(1.9rem, 6.2vw)';
  return (
    <div className="inline-block rounded-2xl p-2 sm:p-3 bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-700/70 shadow-xl backdrop-blur">
      <div className="grid gap-1 sm:gap-1.5" style={{ gridTemplateColumns: `repeat(${state.cols}, ${size})` }}>
        {state.board.map((row, r) => row.map((cell, c) => {
          const crit = criticalMass(state.rows, state.cols, r, c);
          const playable = myTurn && (cell.owner === null || cell.owner === myId);
          const owner = cell.owner != null ? state.players[cell.owner] : null;
          const danger = cell.count === crit - 1 && cell.owner != null;
          const bursting = burstCells.has(`${r},${c}`);
          return (
            <button key={`${r}-${c}`} onClick={() => playable && onMove(r, c)} disabled={!playable}
              className={`relative aspect-square rounded-lg sm:rounded-xl border flex items-center justify-center cell-transition overflow-hidden
                ${playable ? 'cursor-pointer hover:scale-[1.04] hover:brightness-110' : 'cursor-default'}
                ${!owner ? 'bg-slate-100/80 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700' : 'border-transparent'}`}
              style={owner ? { background: `${owner.color}22`, boxShadow: danger ? `inset 0 0 0 1px ${owner.color}88, 0 0 10px ${owner.color}33` : `inset 0 0 0 1px ${owner.color}55` } : undefined}
            >
              {bursting && <span key={burstKey} className="absolute inset-0 rounded-lg sm:rounded-xl animate-burst" style={{ background: owner?.color || currentColor(state) }} />}
              {danger && owner && <span className="absolute inset-0 rounded-lg sm:rounded-xl animate-pulse-glow" style={{ ['--glow' as any]: `${owner.color}66` }} />}
              {cell.count > 0 && owner && <Orbs count={cell.count} color={owner.color} />}
              {playable && !owner && <span className="h-1.5 w-1.5 rounded-full bg-slate-300 dark:bg-slate-600 opacity-70" />}
            </button>
          );
        }))}
      </div>
    </div>
  );
}

function currentColor(state: GameState) { return state.players[state.currentPlayerIndex]?.color || '#888'; }

function Orbs({ count, color }: { count: number; color: string }) {
  const show = Math.min(count, 3);
  const dots = Array.from({ length: show });
  return (
    <div className="relative flex items-center justify-center w-full h-full">
      <div className={`flex items-center justify-center ${show === 1 ? '' : 'gap-[2px] sm:gap-1'}`}>
        {dots.map((_, i) => (
          <span key={i} className="block rounded-full animate-pop shadow"
            style={{ width: show === 1 ? '38%' : '26%', aspectRatio: '1', background: `radial-gradient(circle at 30% 30%, #fff8, ${color})`, boxShadow: `0 0 6px ${color}99` }} />
        ))}
      </div>
      {count > 3 && <span className="absolute bottom-0.5 right-1 text-[9px] sm:text-[10px] font-bold" style={{ color }}>{count}</span>}
    </div>
  );
}
