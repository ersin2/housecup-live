import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BatchDTO, ChangeResponse, JudgeState, LedgerPage, PublicScoreboard, SaveBatchResponse, TeamWithTotalDTO } from '@housecup/shared/types';
import { api, errorMessage, HttpError, isRetryable } from '../../lib/api.ts';
import { loadOutbox, saveOutbox, type PendingBatch } from '../../lib/outbox.ts';
import { store, uuid } from '../../lib/util.ts';

export type Phase = { kind: 'boot' } | { kind: 'login'; error?: string } | { kind: 'ready' };

export interface Toast {
  key: number;
  batch_id: string;
  summary: string;
  label: string | null;
  undone: boolean;
  error?: string;
}

const NAME_KEY = 'hc.judgeName';
const RETRY_MS = 8_000;

export function useJudge(initialToken: string | null, clearToken: () => void) {
  const [phase, setPhase] = useState<Phase>({ kind: 'boot' });
  const [state, setState] = useState<JudgeState | null>(null);
  const [deltas, setDeltas] = useState<Record<number, number>>({});
  const [label, setLabel] = useState('');
  const [outbox, setOutboxState] = useState<PendingBatch[]>(loadOutbox);
  const [sending, setSending] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<Toast | null>(null);
  const [recent, setRecent] = useState<BatchDTO[]>([]);
  const [judgeName, setJudgeNameState] = useState<string>(() => store.get(NAME_KEY, ''));
  const inflight = useRef(new Set<string>());
  const outboxRef = useRef(outbox);

  const setOutbox = useCallback((fn: (l: PendingBatch[]) => PendingBatch[]) => {
    setOutboxState((cur) => {
      const next = fn(cur);
      outboxRef.current = next;
      saveOutbox(next);
      return next;
    });
  }, []);

  const teamName = useCallback(
    (id: number) => state?.teams.find((t) => t.id === id)?.name ?? `Team ${id}`,
    [state],
  );

  const applyTotals = useCallback((totals: Record<number, number>) => {
    setState((s) => (s ? { ...s, teams: s.teams.map((t) => ({ ...t, total: totals[t.id] ?? t.total })) } : s));
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      const page = await api<LedgerPage>('/api/judge/batches?limit=10');
      setRecent(page.batches);
    } catch {
      // drawer simply shows the previous list
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await api<JudgeState>('/api/judge/state');
      setState(s);
      setPhase((p) => (p.kind === 'ready' ? p : { kind: 'ready' }));
      return true;
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        setState(null);
        setPhase({ kind: 'login', error: err.code === 'SESSION_REVOKED' ? err.message : undefined });
      }
      return false;
    }
  }, []);

  // ---------------------------------------------------------------- boot
  useEffect(() => {
    let alive = true;
    (async () => {
      if (initialToken) {
        try {
          const s = await api<JudgeState>('/api/judge/session', {
            json: { token: initialToken, judge_name: store.get(NAME_KEY, '') || null },
          });
          if (!alive) return;
          clearToken(); // keep the secret token out of history and screenshots
          setState(s);
          setPhase({ kind: 'ready' });
        } catch (err) {
          if (!alive) return;
          clearToken();
          setPhase({
            kind: 'login',
            error:
              err instanceof HttpError && err.status === 401
                ? 'This QR code is no longer valid. Ask the organiser for a new judge card, or enter the PIN.'
                : errorMessage(err),
          });
        }
        return;
      }
      const ok = await refresh();
      if (alive && !ok) setPhase((p) => (p.kind === 'boot' ? { kind: 'login' } : p));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No /state polling: live totals, team names/colors, late-entry teams and the freeze flag
  // arrive through the event's WebSocket push (see syncLive). Polling a ledger SUM every few
  // seconds per judge would exhaust D1's free 5M rows-read/day on a busy event.
  useEffect(() => {
    if (phase.kind === 'ready') void loadRecent();
  }, [phase.kind, loadRecent]);

  /** Merge a public snapshot into the pad: stable card order, live names/colors/totals. */
  const syncLive = useCallback((sb: PublicScoreboard) => {
    setState((s) => {
      if (!s || sb.scope !== 'event' || sb.event?.slug !== s.event.slug) return s;
      const teams: TeamWithTotalDTO[] = sb.standings
        .map((t) => ({
          id: t.team_id,
          event_id: s.event.id,
          house_id: t.house_id,
          name: t.name,
          short_name: t.short_name,
          color_hex: t.color_hex,
          sort_order: t.sort_order,
          total: t.total,
        }))
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      return {
        ...s,
        teams,
        event: { ...s.event, name: sb.event.name, is_frozen: sb.event.is_frozen, frozen_at: sb.event.frozen_at },
      };
    });
  }, []);

  // ---------------------------------------------------------------- auth
  const login = useCallback(async (pin: string) => {
    try {
      const s = await api<JudgeState>('/api/judge/session', {
        json: { pin, judge_name: store.get(NAME_KEY, '') || null },
      });
      setState(s);
      setPhase({ kind: 'ready' });
      return null;
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) return 'That PIN doesn’t match an active event. Check the judge card.';
      if (err instanceof HttpError && err.status === 429) return 'Too many tries. Wait a few minutes, or scan the QR code on the judge card.';
      return errorMessage(err);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/judge/logout', { method: 'POST' });
    } catch {
      // cookie expires anyway
    }
    setState(null);
    setDeltas({});
    setPhase({ kind: 'login' });
  }, []);

  const setJudgeName = useCallback((n: string) => {
    setJudgeNameState(n);
    store.set(NAME_KEY, n.trim());
  }, []);

  // ---------------------------------------------------------------- scoring
  const bump = useCallback((teamId: number, n: number) => {
    setDeltas((d) => {
      const v = Math.max(-10000, Math.min(10000, (d[teamId] ?? 0) + n));
      return { ...d, [teamId]: v };
    });
  }, []);

  const setDelta = useCallback((teamId: number, v: number) => {
    setDeltas((d) => ({ ...d, [teamId]: Math.max(-10000, Math.min(10000, v)) }));
  }, []);

  const pendingAwards = useMemo(
    () =>
      (state?.teams ?? [])
        .filter((t) => (deltas[t.id] ?? 0) !== 0)
        .map((t) => ({ event_team_id: t.id, points: deltas[t.id]! })),
    [state, deltas],
  );

  const summarize = useCallback(
    (awards: { event_team_id: number; points: number }[]) =>
      awards.map((a) => `${teamName(a.event_team_id)} ${a.points > 0 ? '+' : '−'}${Math.abs(a.points)}`).join(', '),
    [teamName],
  );

  const send = useCallback(
    async (p: PendingBatch) => {
      if (inflight.current.has(p.batch_id)) return;
      inflight.current.add(p.batch_id);
      setSending((s) => new Set(s).add(p.batch_id));
      try {
        const res = await api<SaveBatchResponse>('/api/judge/batches', {
          json: { batch_id: p.batch_id, label: p.label, judge_name: p.judge_name, awards: p.awards },
        });
        setOutbox((l) => l.filter((x) => x.batch_id !== p.batch_id));
        applyTotals(res.totals);
        setToast({ key: Date.now(), batch_id: p.batch_id, summary: summarize(p.awards), label: p.label, undone: false });
        if (p.label) {
          setState((s) =>
            s ? { ...s, recent_labels: [p.label!, ...s.recent_labels.filter((l) => l !== p.label)].slice(0, 8) } : s,
          );
        }
        void loadRecent();
      } catch (err) {
        if (err instanceof HttpError && err.status === 401) {
          // Keep the entry; it is retried (same batch_id) after signing in again.
          setPhase({ kind: 'login', error: 'Your judge session ended. Sign in again to send the unsaved entry.' });
        } else if (isRetryable(err)) {
          setOutbox((l) => l.map((x) => (x.batch_id === p.batch_id ? { ...x, attempts: x.attempts + 1 } : x)));
        } else {
          setOutbox((l) => l.map((x) => (x.batch_id === p.batch_id ? { ...x, fatal: errorMessage(err) } : x)));
        }
      } finally {
        inflight.current.delete(p.batch_id);
        setSending((s) => {
          const n = new Set(s);
          n.delete(p.batch_id);
          return n;
        });
      }
    },
    [applyTotals, loadRecent, setOutbox, summarize],
  );

  const save = useCallback(() => {
    if (!state || pendingAwards.length === 0) return;
    const p: PendingBatch = {
      batch_id: uuid(),
      event_id: state.event.id,
      label: label.trim() || null,
      judge_name: judgeName.trim() || null,
      awards: pendingAwards,
      queued_at: Date.now(),
      attempts: 0,
    };
    setOutbox((l) => [...l, p]); // persisted before the network is touched
    setDeltas({});
    void send(p);
  }, [state, pendingAwards, label, judgeName, setOutbox, send]);

  const mine = useMemo(() => outbox.filter((p) => p.event_id === state?.event.id), [outbox, state]);

  const retryAll = useCallback(() => {
    outboxRef.current.filter((p) => p.event_id === state?.event.id && !p.fatal).forEach((p) => void send(p));
  }, [send, state]);

  const discard = useCallback((batchId: string) => setOutbox((l) => l.filter((x) => x.batch_id !== batchId)), [setOutbox]);

  // Auto-retry unsent entries: on reconnect, on an interval, and right after sign-in/reload.
  useEffect(() => {
    if (phase.kind !== 'ready' || !mine.some((p) => !p.fatal)) return;
    retryAll();
    const id = setInterval(retryAll, RETRY_MS);
    window.addEventListener('online', retryAll);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', retryAll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind, mine.length]);

  // ---------------------------------------------------------------- undo / restore
  const change = useCallback(
    async (batchId: string, action: 'revert' | 'restore') => {
      try {
        const res = await api<ChangeResponse>(`/api/judge/batches/${batchId}/${action}`, { method: 'POST' });
        applyTotals(res.totals);
        setRecent((r) => r.map((b) => (b.batch_id === batchId ? res.batch : b)));
        return null;
      } catch (err) {
        return errorMessage(err);
      }
    },
    [applyTotals],
  );

  const undoToast = useCallback(async () => {
    if (!toast || toast.undone) return;
    const err = await change(toast.batch_id, 'revert');
    setToast((t) => (t && t.batch_id === toast.batch_id ? { ...t, key: Date.now(), undone: !err, error: err ?? undefined } : t));
  }, [toast, change]);

  return {
    phase,
    state,
    deltas,
    label,
    setLabel,
    bump,
    setDelta,
    pendingAwards,
    summarize,
    save,
    outbox: mine,
    sending,
    retryAll,
    discard,
    toast,
    dismissToast: () => setToast(null),
    undoToast,
    recent,
    loadRecent,
    change,
    login,
    logout,
    judgeName,
    setJudgeName,
    refresh,
    syncLive,
  };
}
