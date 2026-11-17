export interface Env {
  ROOMS: DurableObjectNamespace;
}

function makeId(len = 5) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/') return new Response('Color Wars server running');

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected websocket', { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();

      let doSocket: WebSocket | null = null;
      let pending: string[] = [];
      let initialized = false;

      const flushPending = () => {
        if (!doSocket || doSocket.readyState !== WebSocket.OPEN) return;
        for (const m of pending) doSocket.send(m);
        pending = [];
      };

      server.addEventListener('message', async (ev) => {
        const data = String(ev.data);

        if (initialized) {
          if (doSocket && doSocket.readyState === WebSocket.OPEN) {
            doSocket.send(data);
          } else {
            pending.push(data);
          }
          return;
        }

        // first message must be create or join
        let msg: any;
        try { msg = JSON.parse(data); } catch {
          server.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
          return;
        }
        let roomId = '';
        let action = '';
        const name = (msg?.name || 'Player').toString().trim().slice(0, 20) || 'Player';
        if (msg?.type === 'create') {
          roomId = makeId();
          action = 'create';
        } else if (msg?.type === 'join') {
          roomId = (msg?.roomId || '').toString().toUpperCase().trim();
          action = 'join';
        } else {
          server.send(JSON.stringify({ type: 'error', message: 'Join or create a room first' }));
          return;
        }
        if (!roomId) {
          server.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        initialized = true;

        try {
          const id = env.ROOMS.idFromName(roomId);
          const stub = env.ROOMS.get(id);
          const doUrl = new URL('https://do/websocket');
          doUrl.searchParams.set('roomId', roomId);

          const resp = await stub.fetch(doUrl.toString(), {
            headers: { Upgrade: 'websocket' },
          });
          const ws = resp.webSocket;
          if (!ws) {
            server.send(JSON.stringify({ type: 'error', message: 'Failed to connect to room' }));
            server.close();
            return;
          }
          doSocket = ws;
          ws.accept();

          ws.addEventListener('message', (e) => {
            try { server.send(String(e.data)); } catch {}
          });
          ws.addEventListener('close', () => { try { server.close(); } catch {} });
          ws.addEventListener('error', () => { try { server.close(); } catch {} });

          // init room session in DO, then flush any queued client messages
          ws.send(JSON.stringify({ type: action, roomId, name }));
          flushPending();
        } catch {
          server.send(JSON.stringify({ type: 'error', message: 'Failed to connect to room' }));
          server.close();
        }
      });

      server.addEventListener('close', () => { try { doSocket?.close(); } catch {} });
      server.addEventListener('error', () => { try { doSocket?.close(); } catch {} });

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not found', { status: 404 });
  },
};

export { RoomDO } from './RoomDO';
