import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { onColor } from '@housecup/shared/color';
import type { BatchDTO, TeamWithTotalDTO } from '@housecup/shared/types';
import { Keypad, Sheet, type KeypadKey } from '../../components/ui.tsx';
import { useDocumentTheme, useDocumentTitle } from '../../lib/theme.ts';
import { clock, cx, haptic, signed } from '../../lib/util.ts';
import { Score } from '../scoreboard/parts.tsx';
import { useJudge, type Toast } from './useJudge.ts';

const CHIPS = [1, 3, 5, 10];
const TOAST_MS = 8000;

export function JudgePage() {
  useDocumentTheme('daylight'); // always outdoor-legible
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const clearToken = useCallback(() => navigate('/judge', { replace: true }), [navigate]);
  const j = useJudge(token, clearToken);
  useDocumentTitle(j.state ? `Judge: ${j.state.event.name}` : 'Judge sign-in');

  if (j.phase.kind === 'boot') {
    return <div className="grid min-h-dvh place-items-center bg-white text-lg font-semibold text-neutral-600">Opening judge pad…</div>;
  }
  if (j.phase.kind === 'login' || !j.state) {
    return (
      <PinEntry
        error={j.phase.kind === 'login' ? j.phase.error : undefined}
        onSubmit={j.login}
        judgeName={j.judgeName}
        setJudgeName={j.setJudgeName}
        unsaved={j.outbox.length}
      />
    );
  }
  return <JudgePad j={j} />;
}

// ------------------------------------------------------------------ PIN

function PinEntry({
  error,
  onSubmit,
  judgeName,
  setJudgeName,
  unsaved,
}: {
  error?: string;
  onSubmit: (pin: string) => Promise<string | null>;
  judgeName: string;
  setJudgeName: (n: string) => void;
  unsaved: number;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | undefined>(error);
  useEffect(() => setMsg(error), [error]);

  const submit = async (p: string) => {
    setBusy(true);
    const err = await onSubmit(p);
    setBusy(false);
    if (err) {
      setMsg(err);
      setPin('');
      haptic(40);
    }
  };

  const onKey = (k: KeypadKey) => {
    if (busy) return;
    if (k === 'back') return setPin((p) => p.slice(0, -1));
    if (k === 'clear') return setPin('');
    setPin((p) => {
      if (p.length >= 4) return p;
      const next = p + k;
      if (next.length === 4) void submit(next);
      return next;
    });
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col bg-white px-5 pt-10 pb-6 text-black">
      <h1 className="wide text-3xl font-black">Judge sign-in</h1>
      <p className="mt-2 text-neutral-700">Scan the QR code on your judge card, or enter its 4-digit PIN.</p>

      <div className="mt-8 flex justify-center gap-3" aria-label={`PIN, ${pin.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cx(
              'num grid h-16 w-14 place-items-center rounded-xl border-[3px] text-3xl font-black',
              i < pin.length ? 'border-black' : 'border-neutral-300',
            )}
          >
            {pin[i] ? '•' : ''}
          </span>
        ))}
      </div>
      {msg && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 font-semibold text-red-800">
          {msg}
        </p>
      )}
      {unsaved > 0 && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 font-semibold text-amber-900">
          {unsaved === 1 ? '1 entry is' : `${unsaved} entries are`} waiting to be sent. Sign in to send {unsaved === 1 ? 'it' : 'them'}.
        </p>
      )}

      <div className="mt-6">
        <Keypad onKey={onKey} />
      </div>

      <label className="mt-6 block">
        <span className="text-sm font-semibold text-neutral-700">Your name (optional, shown in the audit log)</span>
        <input
          value={judgeName}
          onChange={(e) => setJudgeName(e.target.value.slice(0, 40))}
          className="mt-1 h-13 w-full rounded-xl border-2 border-neutral-300 px-4 text-lg focus:border-black focus:outline-none"
          placeholder="e.g. Ms. Tan"
          autoComplete="name"
        />
      </label>
    </main>
  );
}

// ------------------------------------------------------------------ pad

type J = ReturnType<typeof useJudge>;

function JudgePad({ j }: { j: J }) {
  const state = j.state!;
  const [keypadTeam, setKeypadTeam] = useState<TeamWithTotalDTO | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const hasPending = j.pendingAwards.length > 0;
  const many = state.teams.length > 4;

  return (
    <div className="min-h-dvh bg-white text-black">
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 px-4 py-2.5 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="semiwide truncate text-lg leading-tight font-black">{state.event.name}</h1>
            <p className="truncate text-sm text-neutral-600">{j.judgeName ? `Judging as ${j.judgeName}` : 'Judge pad'}</p>
          </div>
          <button
            type="button"
            onClick={() => setMenu(true)}
            className="press h-12 shrink-0 rounded-xl border-2 border-neutral-300 px-4 font-semibold"
          >
            Menu
          </button>
        </div>
      </header>

      <main className={cx('mx-auto max-w-5xl px-3 pt-3', drawer ? 'pb-[26rem]' : 'pb-48')}>
        {state.event.is_frozen && (
          <p className="mb-3 rounded-xl border-2 border-black px-4 py-2.5 text-[15px] font-semibold">
            Mystery mode is on. The public board shows scores from {state.event.frozen_at ? clock(state.event.frozen_at) : 'the freeze'}. Keep scoring as normal.
          </p>
        )}

        <LabelPicker value={j.label} onChange={j.setLabel} recent={state.recent_labels} />

        <section
          aria-label="Teams"
          className={cx('mt-3 grid gap-2.5', many ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2')}
        >
          {state.teams.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              delta={j.deltas[t.id] ?? 0}
              onBump={(n) => j.bump(t.id, n)}
              onReset={() => j.setDelta(t.id, 0)}
              onKeypad={() => setKeypadTeam(t)}
            />
          ))}
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30">
        <div className="mx-auto max-w-5xl px-3">
          {j.toast && <SavedToast key={j.toast.key} toast={j.toast} onUndo={j.undoToast} onDone={j.dismissToast} />}
          <Outbox j={j} />
        </div>
        <div className="safe-bottom border-t border-neutral-200 bg-white px-3 pt-2">
          <div className="mx-auto max-w-5xl">
            <RecentDrawer open={drawer} onToggle={() => setDrawer((d) => !d)} j={j} />
            <button
              type="button"
              disabled={!hasPending}
              onClick={() => {
                haptic(15);
                j.save();
              }}
              className={cx(
                'press mt-2 flex min-h-16 w-full flex-col items-center justify-center rounded-2xl px-4 py-2 text-center',
                hasPending ? 'bg-black text-white' : 'bg-neutral-200 text-neutral-500',
              )}
            >
              <span className="wide text-lg leading-tight font-black">Save points</span>
              <span className="num w-full truncate text-[15px] font-semibold">
                {hasPending ? j.summarize(j.pendingAwards) : 'Tap points on a team to start'}
              </span>
            </button>
          </div>
        </div>
      </div>

      <KeypadSheet
        team={keypadTeam}
        current={keypadTeam ? (j.deltas[keypadTeam.id] ?? 0) : 0}
        onClose={() => setKeypadTeam(null)}
        onSet={(v) => keypadTeam && j.setDelta(keypadTeam.id, v)}
      />
      <MenuSheet open={menu} onClose={() => setMenu(false)} j={j} />
    </div>
  );
}

function LabelPicker({ value, onChange, recent }: { value: string; onChange: (v: string) => void; recent: string[] }) {
  return (
    <section aria-label="Activity">
      <div className="relative">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, 60))}
          placeholder="Activity or match (optional), e.g. 100m Sprint"
          aria-label="Activity or match label"
          enterKeyHint="done"
          className="h-13 w-full rounded-xl border-2 border-neutral-300 bg-white pr-14 pl-4 text-[17px] font-semibold placeholder:font-normal placeholder:text-neutral-500 focus:border-black focus:outline-none"
        />
        {value && (
          <button
            type="button"
            aria-label="Clear activity label"
            onClick={() => onChange('')}
            className="absolute top-1/2 right-1 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-lg text-xl text-neutral-600"
          >
            ✕
          </button>
        )}
      </div>
      {recent.length > 0 && (
        <div className="no-scrollbar -mx-3 mt-2 flex gap-2 overflow-x-auto px-3">
          {recent.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => {
                haptic();
                onChange(l);
              }}
              aria-pressed={l === value}
              className={cx(
                'press min-h-11 shrink-0 rounded-full border-2 px-4 text-[15px] font-semibold whitespace-nowrap',
                l === value ? 'border-black bg-black text-white' : 'border-neutral-300 bg-white',
              )}
            >
              {l}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function TeamCard({
  team,
  delta,
  onBump,
  onReset,
  onKeypad,
}: {
  team: TeamWithTotalDTO;
  delta: number;
  onBump: (n: number) => void;
  onReset: () => void;
  onKeypad: () => void;
}) {
  const fg = onColor(team.color_hex);
  const active = delta !== 0;
  return (
    <article
      className={cx('overflow-hidden rounded-2xl border-[3px]', active ? 'border-black' : 'border-transparent')}
      aria-label={`${team.name}, ${team.total} points`}
    >
      <div className="flex min-h-15 items-center gap-3 py-1.5 pr-1.5 pl-4" style={{ background: team.color_hex, color: fg }}>
        <h2 className="semiwide min-w-0 flex-1 truncate text-xl leading-tight font-black">{team.name}</h2>
        <Score value={team.total} className="text-[28px] leading-none font-black" />
        <button
          type="button"
          onClick={onKeypad}
          aria-label={active ? `Pending ${signed(delta)} for ${team.name}. Tap to type a value.` : `Type a custom value for ${team.name}`}
          className={cx(
            'press num h-13 min-w-20 shrink-0 rounded-xl px-3 text-2xl font-black',
            active ? 'bg-white text-black shadow-[0_2px_0_rgba(0,0,0,0.35)]' : 'border-2 border-current/50',
          )}
        >
          {active ? signed(delta) : '±'}
        </button>
      </div>
      <div className="flex gap-1.5 bg-neutral-100 p-1.5">
        {CHIPS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => {
              haptic();
              onBump(n);
            }}
            aria-label={`Add ${n} to ${team.name}`}
            className="press num h-14 flex-1 rounded-xl border-2 border-black bg-white text-[22px] font-black active:bg-black active:text-white"
          >
            +{n}
          </button>
        ))}
        <button
          type="button"
          onClick={onReset}
          disabled={!active}
          aria-label={`Reset ${team.name} to 0`}
          className={cx(
            'press num h-14 w-14 shrink-0 rounded-xl border-2 text-xl font-black',
            active ? 'border-black bg-white text-black' : 'border-dashed border-neutral-300 bg-transparent text-neutral-300',
          )}
        >
          0
        </button>
      </div>
    </article>
  );
}

function KeypadSheet({
  team,
  current,
  onClose,
  onSet,
}: {
  team: TeamWithTotalDTO | null;
  current: number;
  onClose: () => void;
  onSet: (v: number) => void;
}) {
  const [digits, setDigits] = useState('');
  const [negative, setNegative] = useState(false);
  useEffect(() => {
    if (team) {
      setDigits(current === 0 ? '' : String(Math.abs(current)));
      setNegative(current < 0);
    }
  }, [team, current]);

  const value = (negative ? -1 : 1) * Number(digits || '0');
  const onKey = (k: KeypadKey) => {
    if (k === 'back') return setDigits((d) => d.slice(0, -1));
    if (k === 'clear') return setDigits('');
    setDigits((d) => {
      const next = (d + k).replace(/^0+(?=\d)/, '');
      return Number(next) > 10000 ? d : next;
    });
  };

  return (
    <Sheet open={!!team} onClose={onClose} label={team ? `Custom points for ${team.name}` : 'Custom points'}>
      {team && (
        <div className="pb-2">
          <div className="flex items-center gap-3">
            <span className="h-8 w-3 rounded-full" style={{ background: team.color_hex }} />
            <h2 className="semiwide truncate text-xl font-black">{team.name}</h2>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="grid flex-1 grid-cols-2 rounded-2xl bg-neutral-100 p-1">
              {[false, true].map((neg) => (
                <button
                  key={String(neg)}
                  type="button"
                  aria-pressed={negative === neg}
                  onClick={() => setNegative(neg)}
                  className={cx(
                    'h-13 rounded-xl text-lg font-black',
                    negative === neg ? (neg ? 'bg-red-700 text-white' : 'bg-black text-white') : 'text-neutral-600',
                  )}
                >
                  {neg ? '− Penalty' : '+ Points'}
                </button>
              ))}
            </div>
          </div>
          <output
            aria-live="polite"
            className={cx('num my-4 block text-center text-6xl font-black', negative && value !== 0 ? 'text-red-700' : 'text-black')}
          >
            {signed(value)}
          </output>
          <Keypad onKey={onKey} />
          <button
            type="button"
            onClick={() => {
              haptic(15);
              onSet(value);
              onClose();
            }}
            className="press wide mt-3 h-16 w-full rounded-2xl bg-black text-lg font-black text-white"
          >
            {value === 0 ? 'Set to 0' : `Set ${signed(value)}`}
          </button>
        </div>
      )}
    </Sheet>
  );
}

function SavedToast({ toast, onUndo, onDone }: { toast: Toast; onUndo: () => void; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, toast.undone ? 3000 : TOAST_MS);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  return (
    <div
      role="status"
      className={cx(
        'hc-slide-in relative mb-2 overflow-hidden rounded-2xl text-white shadow-[0_10px_30px_rgba(0,0,0,0.25)]',
        toast.undone ? 'bg-neutral-800' : 'bg-[#0A8F3C]',
      )}
    >
      <div className="flex items-center gap-3 py-2.5 pr-2.5 pl-4">
        <span aria-hidden className="text-2xl font-black">
          {toast.undone ? '↺' : '✓'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold opacity-90">
            {toast.undone ? 'Undone' : 'Saved'}
            {(toast.error ?? toast.label) ? `: ${toast.error ?? toast.label}` : ''}
          </div>
          {/* Never truncated: the judge must see exactly what was awarded. */}
          <div className="num text-[17px] leading-snug font-black break-words">{toast.summary}</div>
        </div>
        {!toast.undone && (
          <button
            type="button"
            onClick={onUndo}
            className="press h-13 shrink-0 rounded-xl bg-white px-5 text-lg font-black text-[#0A8F3C]"
          >
            Undo
          </button>
        )}
      </div>
      {!toast.undone && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1 origin-left bg-white/60"
          style={{ animation: `hc-drain ${TOAST_MS}ms linear forwards` }}
        />
      )}
    </div>
  );
}

function Outbox({ j }: { j: J }) {
  if (!j.outbox.length) return null;
  return (
    <div className="mb-2 flex flex-col gap-2">
      {j.outbox.map((p) => {
        const isSending = j.sending.has(p.batch_id);
        const failed = !isSending && (p.attempts > 0 || p.fatal);
        return (
          <div
            key={p.batch_id}
            role={failed ? 'alert' : 'status'}
            className={cx(
              'flex items-center gap-3 rounded-2xl py-2.5 pr-2.5 pl-4 shadow-lg',
              p.fatal ? 'bg-red-700 text-white' : failed ? 'bg-amber-400 text-black' : 'bg-neutral-900 text-white',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="num truncate font-black">
                {isSending ? 'Sending' : p.fatal ? 'Not saved' : 'Not saved yet'}: {j.summarize(p.awards)}
              </div>
              <div className="truncate text-sm opacity-90">
                {p.fatal ?? (isSending ? 'Waiting for the server' : 'No connection. It will retry automatically.')}
              </div>
            </div>
            {!isSending && !p.fatal && (
              <button type="button" onClick={j.retryAll} className="press h-12 shrink-0 rounded-xl bg-black px-4 font-black text-white">
                Retry
              </button>
            )}
            {p.fatal && (
              <button type="button" onClick={() => j.discard(p.batch_id)} className="press h-12 shrink-0 rounded-xl bg-white px-4 font-black text-red-700">
                Dismiss
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RecentDrawer({ open, onToggle, j }: { open: boolean; onToggle: () => void; j: J }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const teams = new Map(j.state!.teams.map((t) => [t.id, t]));
  const act = async (b: BatchDTO) => {
    setBusy(b.batch_id);
    setErr(await j.change(b.batch_id, b.is_reverted ? 'restore' : 'revert'));
    setBusy(null);
  };
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (!open) void j.loadRecent();
          onToggle();
        }}
        aria-expanded={open}
        className="flex h-11 w-full items-center justify-between rounded-xl px-1 text-[15px] font-bold"
      >
        <span>Recent entries</span>
        <span aria-hidden className={cx('transition-transform', open && 'rotate-180')}>
          ▲
        </span>
      </button>
      {open && (
        <div className="max-h-64 overflow-y-auto pb-1">
          {err && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{err}</p>}
          {j.recent.length === 0 && <p className="px-1 py-3 text-neutral-600">Saved entries appear here, newest first.</p>}
          <ul className="flex flex-col gap-1.5">
            {j.recent.map((b) => (
              <li
                key={b.batch_id}
                className={cx('flex items-center gap-3 rounded-xl border-2 px-3 py-2', b.is_reverted ? 'border-dashed border-neutral-300 text-neutral-500' : 'border-neutral-200')}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="num text-sm text-neutral-600">{clock(b.created_at)}</span>
                    <span className={cx('truncate font-bold', b.is_reverted && 'line-through')}>{b.label ?? 'Points'}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {b.awards.map((a) => {
                      const t = teams.get(a.event_team_id);
                      return (
                        <span key={a.event_team_id} className="num inline-flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 text-sm font-bold">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: t?.color_hex ?? '#999' }} />
                          {t?.short_name ?? '?'} {signed(a.points)}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy === b.batch_id}
                  onClick={() => act(b)}
                  className={cx(
                    'press h-12 shrink-0 rounded-xl border-2 px-3 font-black',
                    b.is_reverted ? 'border-black bg-white' : 'border-neutral-300 bg-white',
                  )}
                >
                  {b.is_reverted ? 'Restore' : 'Undo'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MenuSheet({ open, onClose, j }: { open: boolean; onClose: () => void; j: J }) {
  return (
    <Sheet open={open} onClose={onClose} label="Judge menu">
      <div className="flex flex-col gap-3 pb-3">
        <label className="block">
          <span className="text-sm font-semibold text-neutral-700">Your name (shown in the audit log)</span>
          <input
            value={j.judgeName}
            onChange={(e) => j.setJudgeName(e.target.value.slice(0, 40))}
            className="mt-1 h-13 w-full rounded-xl border-2 border-neutral-300 px-4 text-lg focus:border-black focus:outline-none"
            placeholder="e.g. Ms. Tan"
          />
        </label>
        <a href={`/event/${j.state?.event.slug ?? ''}`} target="_blank" rel="noreferrer" className="press grid h-14 place-items-center rounded-xl border-2 border-neutral-300 font-bold">
          Open the public scoreboard
        </a>
        <button
          type="button"
          onClick={() => {
            onClose();
            void j.logout();
          }}
          className="press h-14 rounded-xl bg-neutral-900 font-bold text-white"
        >
          Sign out of this event
        </button>
        <button type="button" onClick={onClose} className="h-12 font-semibold text-neutral-600">
          Close
        </button>
      </div>
    </Sheet>
  );
}
