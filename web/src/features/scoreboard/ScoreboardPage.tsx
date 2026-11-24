import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { PublicEventsResponse, PublicScoreboard, StandingDTO, ThemeMode } from '@housecup/shared/types';
import { QrCode } from '../../components/ui.tsx';
import { useNow } from '../../hooks/motion.ts';
import { useLiveScoreboard, type LiveScope, type LiveStatus } from '../../hooks/useLiveScoreboard.ts';
import { useDocumentTheme, useDocumentTitle } from '../../lib/theme.ts';
import { clock, cx, signed, store } from '../../lib/util.ts';
import { Celebrations, Feed, FrozenBanner, Standings, Ticker, type Celebration } from './parts.tsx';

const THEME_KEY = 'hc.viewerTheme';

function usePublicEvents() {
  const [events, setEvents] = useState<PublicEventsResponse | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/public/events')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setEvents(d as PublicEventsResponse))
        .catch(() => {});
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return events;
}

/** New feed batches → celebration toasts + lane pulses (never on first load). */
function useCelebrations(data: PublicScoreboard | null) {
  const seen = useRef<Set<string> | null>(null);
  const scopeKey = useRef('');
  const [items, setItems] = useState<Celebration[]>([]);
  const [pulses, setPulses] = useState<Record<number, number>>({});

  useEffect(() => {
    if (!data) return;
    const key = `${data.scope}:${data.event?.slug ?? ''}`;
    const ids = data.feed.map((f) => f.batch_id);
    if (!seen.current || scopeKey.current !== key) {
      seen.current = new Set(ids);
      scopeKey.current = key;
      return;
    }
    const fresh = data.feed.filter((f) => !seen.current!.has(f.batch_id)).reverse();
    ids.forEach((id) => seen.current!.add(id));
    if (!fresh.length) return;

    const teams = new Map(data.standings.map((s) => [s.team_id, s]));
    const now = Date.now();
    const nextPulses: Record<number, number> = {};
    const toasts: Celebration[] = fresh.map((f) => {
      const awarded = f.awards.map((a) => ({ a, t: teams.get(a.team_id) })).filter((x): x is { a: typeof x.a; t: StandingDTO } => !!x.t);
      awarded.forEach(({ a }) => (nextPulses[a.team_id] = now));
      const text =
        awarded.length === 1
          ? `${awarded[0]!.t.name} ${signed(awarded[0]!.a.points)}`
          : awarded.map(({ a, t }) => `${t.short_name} ${signed(a.points)}`).join('  ');
      return { id: f.batch_id, text, label: f.label, colors: awarded.map(({ t }) => t.color_hex) };
    });
    setPulses((p) => ({ ...p, ...nextPulses }));
    setItems((cur) => [...toasts, ...cur].slice(0, 3));
    // Not cleared on the next update: each toast owns its own lifetime.
    setTimeout(() => setItems((cur) => cur.filter((c) => !toasts.includes(c))), 5200);
  }, [data]);

  return { items, pulses };
}

function StatusLine({ status, data, now }: { status: LiveStatus; data: PublicScoreboard | null; now: number }) {
  const text =
    status === 'live'
      ? 'Live'
      : status === 'polling'
        ? 'Updating every 15 seconds'
        : status === 'offline'
          ? 'Offline. Showing the last scores received.'
          : 'Connecting';
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <span
        aria-hidden
        className={cx('h-2.5 w-2.5 rounded-full', status === 'live' ? 'hc-live-dot bg-ok' : status === 'offline' ? 'bg-danger' : 'bg-muted')}
      />
      <span>{text}</span>
      {data && status !== 'live' && <span>(as of {clock(Math.min(now, data.generated_at))})</span>}
    </span>
  );
}

function ThemeToggle({ theme, onChange }: { theme: ThemeMode; onChange: (t: ThemeMode) => void }) {
  const next = theme === 'daylight' ? 'arena' : 'daylight';
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      className="press inline-flex h-11 items-center gap-2 rounded-full border border-rule px-4 text-sm font-semibold"
      aria-label={`Switch to ${next === 'arena' ? 'Arena dark' : 'Daylight'} theme`}
    >
      <span aria-hidden className="inline-block h-4 w-4 rounded-full border-2 border-ink bg-[linear-gradient(90deg,var(--ink)_50%,transparent_50%)]" />
      {theme === 'daylight' ? 'Daylight' : 'Arena'}
    </button>
  );
}

export function ScoreboardPage({ season = false }: { season?: boolean }) {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const tv = params.get('tv') === '1';
  const scope: LiveScope = season ? { kind: 'season' } : slug ? { kind: 'event', slug } : { kind: 'featured' };
  const { data, status, error } = useLiveScoreboard(scope);
  const events = usePublicEvents();
  const now = useNow(tv ? 15_000 : 30_000);
  const [viewerTheme, setViewerTheme] = useState<ThemeMode | null>(() => store.get<ThemeMode | null>(THEME_KEY, null));
  const theme: ThemeMode = viewerTheme ?? data?.display.theme_mode ?? 'daylight';
  useDocumentTheme(theme);
  useDocumentTitle(data ? `${data.display.title} | HouseCup Live` : 'HouseCup Live');
  const { items, pulses } = useCelebrations(data);
  const teams = useMemo(() => new Map((data?.standings ?? []).map((s) => [s.team_id, s])), [data]);

  const setTheme = (t: ThemeMode) => {
    setViewerTheme(t);
    store.set(THEME_KEY, t);
  };

  const currentKey = data?.scope === 'season' ? 'season' : data?.event?.slug;
  const shareUrl = `${location.origin}${data?.scope === 'season' ? '/season' : data?.event ? `/event/${data.event.slug}` : '/'}`;

  if (error?.status === 404) {
    return (
      <main className="mx-auto max-w-xl px-4 py-24">
        <h1 className="wide text-4xl font-black">This event doesn’t exist</h1>
        <p className="mt-3 text-muted">
          It may have been renamed or removed. <Link className="font-semibold text-ink underline" to="/">See the live scoreboard</Link>.
        </p>
      </main>
    );
  }

  if (tv) return <TvBoard data={data} status={status} now={now} teams={teams} pulses={pulses} items={items} shareUrl={shareUrl} />;

  return (
    <div className="min-h-dvh">
      <header className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="wide text-sm font-black tracking-tight">
            HouseCup Live
          </Link>
          <ThemeToggle theme={theme} onChange={setTheme} />
        </div>
        <nav aria-label="Competitions" className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {events?.season_available && (
            <NavChip to="/season" active={currentKey === 'season'}>
              Season Cup
            </NavChip>
          )}
          {events?.events.map((e) => (
            <NavChip key={e.slug} to={`/event/${e.slug}`} active={currentKey === e.slug}>
              {e.name}
            </NavChip>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6 pb-28 sm:px-6">
        {!data ? (
          <BoardSkeleton status={status} />
        ) : data.standings.length === 0 ? (
          <section className="py-16">
            <h1 className="wide text-4xl font-black">{data.display.title}</h1>
            <p className="mt-3 text-muted">No teams yet. Scores appear here as soon as the organiser sets up an event.</p>
          </section>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <h1 className="wide text-[clamp(2rem,6vw,4rem)] leading-[0.95] font-black tracking-tight">{data.display.title}</h1>
              <StatusLine status={status} data={data} now={now} />
            </div>
            {data.display.is_frozen && (
              <div className="mt-5">
                <FrozenBanner season={data.scope === 'season'} frozenAt={data.event?.frozen_at ?? null} />
              </div>
            )}
            <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <section aria-label="Standings">
                <Standings standings={data.standings} pulses={pulses} />
              </section>
              <section aria-labelledby="latest">
                <h2 id="latest" className="semiwide mb-3 text-lg font-black">
                  Latest points
                </h2>
                <Feed feed={data.feed} teams={teams} now={now} />
              </section>
            </div>
          </>
        )}
      </main>

      {data?.display.announcement_text && (
        <div className="fixed inset-x-0 bottom-0 z-30">
          <Ticker text={data.display.announcement_text} />
        </div>
      )}
      <Celebrations items={items} />
    </div>
  );
}

function NavChip({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold whitespace-nowrap',
        active ? 'border-ink bg-ink text-paper' : 'border-rule text-ink hover:border-ink',
      )}
    >
      {children}
    </Link>
  );
}

function BoardSkeleton({ status }: { status: LiveStatus }) {
  return (
    <div aria-busy="true">
      <div className="h-12 w-2/3 rounded-lg bg-sunk" />
      <div className="mt-8 flex flex-col gap-2.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-raise" />
        ))}
      </div>
      {status === 'offline' && <p className="mt-6 text-muted">Can’t reach the scoreboard. Retrying automatically.</p>}
    </div>
  );
}

function TvBoard({
  data,
  status,
  now,
  teams,
  pulses,
  items,
  shareUrl,
}: {
  data: PublicScoreboard | null;
  status: LiveStatus;
  now: number;
  teams: Map<number, StandingDTO>;
  pulses: Record<number, number>;
  items: Celebration[];
  shareUrl: string;
}) {
  return (
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <header className="flex items-end justify-between gap-[2vw] px-[3vw] pt-[3vh] pb-[2vh]">
        <h1 className="wide truncate text-[6.5vh] leading-none font-black tracking-tight">{data?.display.title ?? 'HouseCup Live'}</h1>
        <div className="flex shrink-0 items-center gap-[1.5vw] text-[2.4vh]">
          {status === 'live' && <span aria-hidden className="hc-live-dot h-[1.4vh] w-[1.4vh] rounded-full bg-ok" />}
          <span className="num font-bold">{clock(now)}</span>
        </div>
      </header>

      <main className="grid min-h-0 grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)] gap-[3vw] px-[3vw] pb-[2vh]">
        <section aria-label="Standings" className="flex min-h-0 flex-col gap-[2vh]">
          {data?.display.is_frozen && <FrozenBanner tv season={data.scope === 'season'} frozenAt={data.event?.frozen_at ?? null} />}
          {data && <Standings standings={data.standings} pulses={pulses} tv />}
        </section>
        <aside className="flex min-h-0 flex-col justify-between gap-[3vh]">
          <div className="min-h-0 overflow-hidden">
            <h2 className="semiwide mb-[1.5vh] text-[2.6vh] font-black">Latest points</h2>
            {data && <Feed feed={data.feed} teams={teams} now={now} tv limit={5} />}
          </div>
          <div className="flex items-center gap-[1.2vw]">
            <QrCode value={shareUrl} size={Math.round(Math.min(innerHeight * 0.17, 220))} className="shrink-0 rounded-[1vh] p-[0.6vh]" />
            <p className="semiwide text-[2.4vh] leading-tight font-bold">Scan for live scores on your phone</p>
          </div>
        </aside>
      </main>

      <footer className="min-w-0 overflow-hidden">{data?.display.announcement_text ? <Ticker tv text={data.display.announcement_text} /> : <div className="h-[1vh]" />}</footer>
      <Celebrations items={items} tv />
    </div>
  );
}
