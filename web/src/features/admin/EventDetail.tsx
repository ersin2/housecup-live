import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { AdminEventDTO, BatchDTO, HouseDTO, LedgerPage, TeamWithTotalDTO, ThemeMode } from '@housecup/shared/types';
import { Button, Segmented, TeamTag, Toggle } from '../../components/ui.tsx';
import { errorMessage } from '../../lib/api.ts';
import { useDocumentTitle } from '../../lib/theme.ts';
import { clock, cx, signed } from '../../lib/util.ts';
import { adminApi, BackLink, ColorPicker, ErrorNote, HouseSelect, inputCls, Panel, StatusChips, useLoad } from './common.tsx';

export function EventDetail() {
  const { id } = useParams();
  const { data, setData, error, reload } = useLoad<{ event: AdminEventDTO }>(`/events/${id}`);
  const { data: housesData } = useLoad<{ houses: HouseDTO[] }>('/houses');
  const [actionError, setActionError] = useState<string | null>(null);
  const event = data?.event;
  useDocumentTitle(event ? `${event.name} | HouseCup admin` : 'Event | HouseCup admin');

  /** Run an admin call that returns the updated event. */
  const run = async (path: string, init: Parameters<typeof adminApi>[1]) => {
    setActionError(null);
    try {
      const res = await adminApi<{ event: AdminEventDTO }>(path, init);
      setData(res);
      return true;
    } catch (e) {
      setActionError(errorMessage(e));
      return false;
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!event) return <p className="text-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-10">
      <div>
        <BackLink to="/admin">Events</BackLink>
        <h1 className="wide mt-2 text-3xl font-black">{event.name}</h1>
        <div className="mt-2">
          <StatusChips e={event} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <a className="inline-flex min-h-11 items-center rounded-xl bg-sunk px-4 font-semibold" href={`/event/${event.slug}`} target="_blank" rel="noreferrer">
            Open scoreboard
          </a>
          <a className="inline-flex min-h-11 items-center rounded-xl bg-sunk px-4 font-semibold" href={`/event/${event.slug}?tv=1`} target="_blank" rel="noreferrer">
            Open TV mode
          </a>
          <Link className="inline-flex min-h-11 items-center rounded-xl bg-ink px-4 font-semibold text-paper" to={`/admin/events/${event.id}/print`}>
            Print judge card
          </Link>
          <a className="inline-flex min-h-11 items-center rounded-xl bg-sunk px-4 font-semibold" href={`/api/admin/events/${event.id}/export.csv`}>
            Download CSV
          </a>
        </div>
      </div>
      <ErrorNote>{actionError}</ErrorNote>

      <LiveControls event={event} run={run} />
      <JudgeAccess event={event} run={run} />
      <TeamsEditor event={event} houses={housesData?.houses ?? []} run={run} />
      <Ledger event={event} onChanged={reload} />
      <Settings event={event} run={run} />
    </div>
  );
}

type Run = (path: string, init: Parameters<typeof adminApi>[1]) => Promise<boolean>;

function LiveControls({ event, run }: { event: AdminEventDTO; run: Run }) {
  const [text, setText] = useState(event.announcement_text ?? '');
  useEffect(() => setText(event.announcement_text ?? ''), [event.announcement_text]);
  const archived = event.status === 'archived';
  return (
    <Panel title="Live show controls">
      <div className="grid gap-x-10 md:grid-cols-2">
        <div className="divide-y divide-rule">
          <Toggle
            label="Show on the main screen"
            hint="The home page and TV mode follow this event."
            checked={event.is_featured}
            disabled={archived}
            onChange={(v) => run(`/events/${event.id}/feature`, { json: { featured: v } })}
          />
          <Toggle
            label="Mystery mode"
            hint={
              event.is_frozen && event.frozen_at
                ? `Public scores are frozen at ${clock(event.frozen_at)}. Judges keep scoring. Turn off to reveal.`
                : 'Freeze public scores for a final reveal. Judges keep scoring.'
            }
            checked={event.is_frozen}
            onChange={(v) => run(`/events/${event.id}/freeze`, { json: { frozen: v } })}
          />
          <Toggle
            label="Counts toward the Season Cup"
            checked={event.counts_toward_season}
            onChange={(v) => run(`/events/${event.id}`, { method: 'PATCH', json: { counts_toward_season: v } })}
          />
          <div className="flex items-center justify-between gap-4 py-3">
            <span className="font-semibold">Scoreboard theme</span>
            <Segmented<ThemeMode>
              label="Scoreboard theme"
              value={event.theme_mode}
              onChange={(v) => run(`/events/${event.id}`, { method: 'PATCH', json: { theme_mode: v } })}
              options={[
                { value: 'daylight', label: 'Daylight' },
                { value: 'arena', label: 'Arena' },
              ]}
            />
          </div>
        </div>
        <div className="pt-3">
          <label className="block">
            <span className="font-semibold">Announcement ticker</span>
            <span className="block text-sm text-muted">Scrolls along the bottom of the scoreboard. Leave empty to hide it.</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 280))}
              rows={3}
              className={cx(inputCls, 'mt-2 h-auto w-full py-2')}
              placeholder="e.g. Relay finals at 14:00 on Track A"
            />
          </label>
          <div className="mt-2 flex items-center gap-2">
            <Button
              disabled={text === (event.announcement_text ?? '')}
              onClick={() => run(`/events/${event.id}`, { method: 'PATCH', json: { announcement_text: text } })}
            >
              Update ticker
            </Button>
            {event.announcement_text && (
              <Button variant="ghost" onClick={() => run(`/events/${event.id}`, { method: 'PATCH', json: { announcement_text: null } })}>
                Remove ticker
              </Button>
            )}
            <span className="ml-auto text-sm text-muted">{text.length}/280</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function JudgeAccess({ event, run }: { event: AdminEventDTO; run: Run }) {
  const link = `${location.origin}/judge?token=${event.judge_token}`;
  const [copied, setCopied] = useState(false);
  return (
    <Panel title="Judge access">
      <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
        <div>
          <div className="text-sm text-muted">PIN</div>
          <div className="num wide text-4xl font-black tracking-[0.15em]">{event.judge_pin}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-muted">Judge link (same as the QR code)</div>
          <div className="mt-1 flex gap-2">
            <input readOnly value={link} aria-label="Judge link" className={cx(inputCls, 'w-full font-mono text-sm')} onFocus={(e) => e.target.select()} />
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  // clipboard blocked; the field is selectable
                }
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            if (confirm('Issue a new PIN and QR code? Judges currently signed in will need the new card.')) {
              void run(`/events/${event.id}/rotate-credentials`, { method: 'POST' });
            }
          }}
        >
          Reset judge access
        </Button>
      </div>
    </Panel>
  );
}

function TeamsEditor({ event, houses, run }: { event: AdminEventDTO; houses: HouseDTO[]; run: Run }) {
  const [adding, setAdding] = useState({ name: '', color_hex: '#6B7280' });
  const move = (i: number, dir: -1 | 1) => {
    const ids = event.teams.map((t) => t.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void run(`/events/${event.id}/teams/order`, { method: 'PUT', json: { ids } });
  };
  return (
    <Panel title="Teams" actions={<span className="text-sm text-muted">Renames and color changes never touch score history.</span>}>
      <ol className="flex flex-col gap-2">
        {event.teams.map((t, i) => (
          <TeamRow key={`${t.id}:${t.name}:${t.short_name}:${t.color_hex}:${t.house_id}`} team={t} houses={houses} index={i} count={event.teams.length} run={run} move={move} />
        ))}
      </ol>
      {event.teams.length < 12 && (
        <form
          className="mt-4 flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(`/events/${event.id}/teams`, { json: { name: adding.name.trim(), color_hex: adding.color_hex } })) {
              setAdding({ name: '', color_hex: '#6B7280' });
            }
          }}
        >
          <ColorPicker label="New team color" value={adding.color_hex} onChange={(c) => setAdding((a) => ({ ...a, color_hex: c }))} />
          <input
            aria-label="New team name"
            value={adding.name}
            onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value.slice(0, 40) }))}
            placeholder="Late entry team name"
            className={cx(inputCls, 'w-full max-w-xs')}
          />
          <Button type="submit" variant="secondary" disabled={!adding.name.trim()}>
            Add team
          </Button>
        </form>
      )}
    </Panel>
  );
}

function TeamRow({
  team,
  houses,
  index,
  count,
  run,
  move,
}: {
  team: TeamWithTotalDTO;
  houses: HouseDTO[];
  index: number;
  count: number;
  run: Run;
  move: (i: number, d: -1 | 1) => void;
}) {
  const [draft, setDraft] = useState({ name: team.name, short_name: team.short_name, color_hex: team.color_hex, house_id: team.house_id });
  const dirty =
    draft.name !== team.name || draft.short_name !== team.short_name || draft.color_hex !== team.color_hex || draft.house_id !== team.house_id;
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-rule p-2 lg:flex-nowrap">
      <ColorPicker label={`Color for ${team.name}`} value={draft.color_hex} onChange={(c) => setDraft((d) => ({ ...d, color_hex: c }))} />
      <input
        aria-label="Team name"
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value.slice(0, 40) }))}
        className={cx(inputCls, 'min-w-40 flex-1 font-semibold')}
      />
      <input
        aria-label="Short code"
        value={draft.short_name}
        onChange={(e) => setDraft((d) => ({ ...d, short_name: e.target.value.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 4).toUpperCase() }))}
        className={cx(inputCls, 'wide w-20 text-center font-black')}
      />
      {houses.length > 0 && (
        <HouseSelect houses={houses} value={draft.house_id} onChange={(v) => setDraft((d) => ({ ...d, house_id: v }))} className="w-auto lg:w-44" />
      )}
      <span className="num w-16 text-right font-black">{team.total}</span>
      <span className="flex gap-1">
        {dirty ? (
          <Button
            onClick={() =>
              run(`/teams/${team.id}`, {
                method: 'PATCH',
                json: { name: draft.name.trim(), short_name: draft.short_name || undefined, color_hex: draft.color_hex, house_id: draft.house_id },
              })
            }
            disabled={!draft.name.trim()}
          >
            Save
          </Button>
        ) : (
          <>
            <Button variant="ghost" className="w-11 px-0" aria-label={`Move ${team.name} up`} disabled={index === 0} onClick={() => move(index, -1)}>
              ↑
            </Button>
            <Button variant="ghost" className="w-11 px-0" aria-label={`Move ${team.name} down`} disabled={index === count - 1} onClick={() => move(index, 1)}>
              ↓
            </Button>
            <Button
              variant="ghost"
              className="w-11 px-0"
              aria-label={`Delete ${team.name}`}
              onClick={() => confirm(`Delete ${team.name}? Teams with points can’t be deleted.`) && run(`/teams/${team.id}`, { method: 'DELETE' })}
            >
              ✕
            </Button>
          </>
        )}
      </span>
    </li>
  );
}

function Ledger({ event, onChanged }: { event: AdminEventDTO; onChanged: () => void }) {
  const [team, setTeam] = useState<number | ''>('');
  const [state, setState] = useState<'' | 'active' | 'reverted'>('');
  const [batches, setBatches] = useState<BatchDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const teams = new Map(event.teams.map((t) => [t.id, t]));

  const load = async (append: string | null) => {
    const q = new URLSearchParams({ limit: '25' });
    if (team) q.set('team', String(team));
    if (state) q.set('state', state);
    if (append) q.set('cursor', append);
    try {
      const page = await adminApi<LedgerPage>(`/events/${event.id}/ledger?${q}`);
      setBatches((b) => (append ? [...b, ...page.batches] : page.batches));
      setCursor(page.next_cursor);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, state, event.id]);

  const act = async (b: BatchDTO) => {
    try {
      await adminApi(`/batches/${b.batch_id}/${b.is_reverted ? 'restore' : 'revert'}`, { method: 'POST' });
      await load(null);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Panel
      title="Audit ledger"
      actions={
        <div className="flex flex-wrap gap-2">
          <select aria-label="Filter by team" value={team} onChange={(e) => setTeam(e.target.value ? Number(e.target.value) : '')} className={cx(inputCls, 'w-auto')}>
            <option value="">All teams</option>
            {event.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select aria-label="Filter by state" value={state} onChange={(e) => setState(e.target.value as typeof state)} className={cx(inputCls, 'w-auto')}>
            <option value="">Counted and undone</option>
            <option value="active">Counted only</option>
            <option value="reverted">Undone only</option>
          </select>
        </div>
      }
    >
      <ErrorNote>{error}</ErrorNote>
      {batches.length === 0 ? (
        <p className="text-muted">No entries match. Entries appear here as judges save points.</p>
      ) : (
        <ul className="divide-y divide-rule border-y border-rule">
          {batches.map((b) => (
            <li key={b.batch_id} className={cx('flex flex-wrap items-center gap-x-4 gap-y-2 py-3', b.is_reverted && 'text-muted')}>
              <span className="num w-20 shrink-0 text-sm whitespace-nowrap">{clock(b.created_at)}</span>
              <span className="min-w-0 flex-1">
                <span className={cx('block font-semibold', b.is_reverted && 'line-through')}>{b.label ?? 'Points'}</span>
                <span className="text-sm text-muted">
                  {b.judge_name ?? 'Unnamed judge'}
                  {b.is_reverted && b.reverted_at ? `, undone at ${clock(b.reverted_at)}` : ''}
                </span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                {b.awards.map((a) => {
                  const t = teams.get(a.event_team_id);
                  return (
                    <span key={a.event_team_id} className="inline-flex items-stretch overflow-hidden rounded-md border border-rule">
                      <TeamTag color={t?.color_hex ?? '#6B7280'} className="px-1.5 text-[11px]">
                        {t?.short_name ?? '?'}
                      </TeamTag>
                      <span className="num px-1.5 text-sm font-bold">{signed(a.points)}</span>
                    </span>
                  );
                })}
              </span>
              <Button variant="secondary" className="min-h-10 text-sm" onClick={() => act(b)}>
                {b.is_reverted ? 'Restore' : 'Undo'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <Button variant="ghost" className="mt-3" onClick={() => load(cursor)}>
          Show older entries
        </Button>
      )}
    </Panel>
  );
}

function Settings({ event, run }: { event: AdminEventDTO; run: Run }) {
  const navigate = useNavigate();
  const [name, setName] = useState(event.name);
  const [confirmSlug, setConfirmSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(event.name), [event.name]);
  return (
    <Panel title="Event settings">
      <div className="flex flex-col gap-6">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(`/events/${event.id}`, { method: 'PATCH', json: { name: name.trim() } });
          }}
        >
          <label className="min-w-60 flex-1">
            <span className="text-sm font-semibold">Event name</span>
            <input value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} className={cx(inputCls, 'mt-1 w-full')} />
          </label>
          <Button type="submit" variant="secondary" disabled={!name.trim() || name.trim() === event.name}>
            Rename
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() =>
              run(`/events/${event.id}`, { method: 'PATCH', json: { status: event.status === 'active' ? 'archived' : 'active' } })
            }
          >
            {event.status === 'active' ? 'Archive event' : 'Reopen event'}
          </Button>
          <span className="text-sm text-muted">
            {event.status === 'active'
              ? 'Archived events stop accepting scores but keep their results page and Season Cup points.'
              : 'Reopening lets judges score again.'}
          </span>
        </div>

        <div className="rounded-xl border-2 border-danger/40 p-4">
          <h3 className="font-bold">Delete event</h3>
          <p className="mt-1 text-sm text-muted">
            Permanently removes the event, its teams and every score. Type <strong className="font-mono text-ink">{event.slug}</strong> to confirm.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input aria-label="Type the event slug to confirm" value={confirmSlug} onChange={(e) => setConfirmSlug(e.target.value)} className={cx(inputCls, 'w-full max-w-xs font-mono')} />
            <Button
              variant="danger"
              disabled={confirmSlug !== event.slug}
              onClick={async () => {
                try {
                  await adminApi(`/events/${event.id}`, { method: 'DELETE', json: { confirm_slug: confirmSlug } });
                  navigate('/admin');
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              Delete permanently
            </Button>
          </div>
          <div className="mt-2">
            <ErrorNote>{error}</ErrorNote>
          </div>
        </div>
      </div>
    </Panel>
  );
}
