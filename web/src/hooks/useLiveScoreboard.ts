// Live scoreboard data: WebSocket push from the ScoreHub Durable Object, with ETag polling
// as a fallback. Hidden phone tabs disconnect after a minute to save free-tier connections.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveMessage, PublicScoreboard } from '@housecup/shared/types';

export type LiveScope = { kind: 'featured' } | { kind: 'event'; slug: string } | { kind: 'season' };
export type LiveStatus = 'connecting' | 'live' | 'polling' | 'offline';

const POLL_MS = 15_000;
const STALE_MS = 80_000; // server heartbeat is every 50 s
const HIDDEN_DISCONNECT_MS = 60_000;

function query(scope: LiveScope): string {
  if (scope.kind === 'event') return `?event=${encodeURIComponent(scope.slug)}`;
  if (scope.kind === 'season') return '?scope=season';
  return '';
}

export function useLiveScoreboard(scope: LiveScope) {
  const [data, setData] = useState<PublicScoreboard | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [error, setError] = useState<{ status: number } | null>(null);
  const etag = useRef<string | null>(null);
  const q = query(scope);

  const accept = useCallback((sb: PublicScoreboard) => {
    if (sb.etag === etag.current) return;
    etag.current = sb.etag;
    setData(sb);
  }, []);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let staleTimer: ReturnType<typeof setInterval> | undefined;
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let lastMessage = Date.now();
    etag.current = null;
    setData(null);
    setError(null);
    setStatus('connecting');

    const poll = async () => {
      try {
        const res = await fetch(`/api/public/scoreboard${q}`, {
          headers: etag.current ? { 'If-None-Match': `"${etag.current}"` } : {},
        });
        if (res.status === 304) return;
        if (!res.ok) {
          if (res.status === 404) setError({ status: 404 });
          return;
        }
        accept((await res.json()) as PublicScoreboard);
        if (!ws || ws.readyState !== WebSocket.OPEN) setStatus('polling');
      } catch {
        if (!ws || ws.readyState !== WebSocket.OPEN) setStatus('offline');
      }
    };

    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(poll, POLL_MS);
    };
    const stopPolling = () => {
      clearInterval(pollTimer);
      pollTimer = undefined;
    };

    const connect = () => {
      if (disposed || document.visibilityState === 'hidden') return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      try {
        ws = new WebSocket(`${proto}://${location.host}/api/public/live${q}`);
      } catch {
        scheduleReconnect();
        return;
      }
      ws.onopen = () => {
        failures = 0;
        lastMessage = Date.now();
        setStatus('live');
        stopPolling();
      };
      ws.onmessage = (e) => {
        lastMessage = Date.now();
        if (e.data === 'pong') return;
        try {
          const msg = JSON.parse(e.data as string) as LiveMessage;
          if (msg.t === 'snapshot') accept(msg.data);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        ws = null;
        if (disposed) return;
        setStatus((s) => (s === 'live' ? 'polling' : s));
        startPolling();
        scheduleReconnect();
      };
      ws.onerror = () => ws?.close();
    };

    const scheduleReconnect = () => {
      clearTimeout(retryTimer);
      failures++;
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(failures, 6)) + Math.random() * 1000;
      retryTimer = setTimeout(connect, delay);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenTimer = setTimeout(() => {
          ws?.close(1000, 'hidden');
          stopPolling();
        }, HIDDEN_DISCONNECT_MS);
      } else {
        clearTimeout(hiddenTimer);
        void poll();
        if (!ws) connect();
        else if (ws.readyState === WebSocket.OPEN) ws.send('ping'); // answered by auto-response
      }
    };

    void poll(); // fast first paint from the edge cache
    connect();
    staleTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastMessage > STALE_MS) ws.close();
    }, 20_000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onVisibility);
      clearTimeout(retryTimer);
      clearTimeout(hiddenTimer);
      clearInterval(staleTimer);
      stopPolling();
      ws?.close(1000, 'unmount');
    };
  }, [q, accept]);

  return { data, status, error };
}
