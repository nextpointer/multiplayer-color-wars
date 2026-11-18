import { useCallback, useMemo, useRef, useState } from 'react';

export type ConnQuality = 'good' | 'ok' | 'bad' | 'offline';

export interface PlayerConn {
  connected: boolean;
  quality: ConnQuality;
}

function qualityFromRtt(rtt: number | null, connected: boolean): ConnQuality {
  if (!connected) return 'offline';
  if (rtt == null) return 'good';
  if (rtt < 180) return 'good';
  if (rtt < 450) return 'ok';
  return 'bad';
}

export function useConnectionQuality() {
  const [myRtt, setMyRtt] = useState<number | null>(null);
  const [myQuality, setMyQuality] = useState<ConnQuality>('good');
  const [playersConn, setPlayersConn] = useState<Record<number, PlayerConn>>({});
  const pendingPingTsRef = useRef<number | null>(null);
  const lastSentQualityRef = useRef<ConnQuality>('good');

  const onConnected = useCallback(() => {
    setMyQuality((q) => (q === 'offline' ? 'good' : q));
  }, []);

  const onDisconnected = useCallback(() => {
    setMyRtt(null);
    setMyQuality('offline');
    pendingPingTsRef.current = null;
  }, []);

  const markPingSent = useCallback((ts: number) => {
    pendingPingTsRef.current = ts;
  }, []);

  const onPong = useCallback((ts?: number) => {
    const sent = pendingPingTsRef.current;
    if (typeof ts === 'number' && sent === ts) {
      const rtt = Math.max(0, Math.round(performance.now() - ts));
      pendingPingTsRef.current = null;
      setMyRtt(rtt);
      setMyQuality(qualityFromRtt(rtt, true));
      return { rtt, quality: qualityFromRtt(rtt, true) as ConnQuality };
    }
    if (typeof ts !== 'number' && sent != null) {
      // fallback if server didn't echo ts
      const rtt = Math.max(0, Math.round(performance.now() - sent));
      pendingPingTsRef.current = null;
      setMyRtt(rtt);
      setMyQuality(qualityFromRtt(rtt, true));
      return { rtt, quality: qualityFromRtt(rtt, true) as ConnQuality };
    }
    return null;
  }, []);

  const onPlayers = useCallback((players?: Array<{ id: number; connected?: boolean; quality?: ConnQuality }>) => {
    if (!players) return;
    setPlayersConn((prev) => {
      const next = { ...prev };
      for (const p of players) {
        next[p.id] = {
          connected: p.connected ?? true,
          quality: (p.connected === false ? 'offline' : (p.quality || 'good')) as ConnQuality,
        };
      }
      return next;
    });
  }, []);

  const shouldReportQuality = useCallback((quality: ConnQuality) => {
    if (lastSentQualityRef.current !== quality) {
      lastSentQualityRef.current = quality;
      return true;
    }
    return false;
  }, []);

  const qualityBorder = useCallback((q: ConnQuality | undefined) => {
    if (q === 'good') return '#22c55e';
    if (q === 'ok') return '#eab308';
    if (q === 'bad') return '#ef4444';
    if (q === 'offline') return '#6b7280';
    return undefined;
  }, []);

  return useMemo(() => ({
    myRtt,
    myQuality,
    playersConn,
    onConnected,
    onDisconnected,
    markPingSent,
    onPong,
    onPlayers,
    shouldReportQuality,
    qualityBorder,
  }), [myRtt, myQuality, playersConn, onConnected, onDisconnected, markPingSent, onPong, onPlayers, shouldReportQuality, qualityBorder]);
}
