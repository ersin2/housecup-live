import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router';
import type { AdminEventDTO } from '@housecup/shared/types';
import { Button } from '../../components/ui.tsx';
import { api, errorMessage, HttpError } from '../../lib/api.ts';
import { useDocumentTheme, useDocumentTitle } from '../../lib/theme.ts';
import { cx } from '../../lib/util.ts';
import { adminApi, ErrorNote, inputCls, StatusChips, useLoad } from './common.tsx';
import { EventBuilder } from './EventBuilder.tsx';
import { EventDetail } from './EventDetail.tsx';
import { HousesManager } from './HousesManager.tsx';
import { PrintCard } from './PrintCard.tsx';

export default function AdminApp() {
  useDocumentTheme('daylight');
  const [authed, setAuthed] = useState<boolean | null>(null);
  const location = useLocation();

  useEffect(() => {
    adminApi('/me')
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <div className="p-6 text-muted">Loading…</div>;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  if (/\/admin\/events\/\d+\/print$/.test(location.pathname)) {
    return (
      <Routes>
        <Route path="events/:id/print" element={<PrintCard />} />
      </Routes>
    );
  }

  const nav = ({ isActive }: { isActive: boolean }) =>
    cx('rounded-lg px-3 py-2 text-sm font-semibold', isActive ? 'bg-ink text-paper' : 'text-muted hover:text-ink');

  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/admin" className="wide text-lg font-black">
            HouseCup admin
          </Link>
          <nav aria-label="Admin" className="flex flex-wrap items-center gap-1">
            <NavLink to="/admin" end className={nav}>
              Events
            </NavLink>
            <NavLink to="/admin/houses" className={nav}>
              School houses
            </NavLink>
            <a href="/" target="_blank" rel="noreferrer" className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:text-ink">
              Public scoreboard
            </a>
            <Button
              variant="ghost"
              className="min-h-9 text-sm"
              onClick={async () => {
                await adminApi('/logout', { method: 'POST' }).catch(() => {});
                setAuthed(false);
              }}
            >
              Sign out
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="events/new" element={<EventBuilder />} />
          <Route path="events/:id" element={<EventDetail />} />
          <Route path="houses" element={<HousesManager />} />
          <Route path="*" element={<p>That admin page doesn’t exist.</p>} />
        </Routes>
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  useDocumentTitle('Admin sign-in');
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/admin/login', { json: { passcode } });
      onDone();
    } catch (err) {
      setError(
        err instanceof HttpError && err.status === 401
          ? 'Wrong passcode.'
          : err instanceof HttpError && err.status === 429
            ? 'Too many attempts. Try again in a few minutes.'
            : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto max-w-sm px-5 py-20">
      <h1 className="wide text-3xl font-black">Admin sign-in</h1>
      <p className="mt-2 text-muted">Enter the organiser passcode to manage events, teams and scores.</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
        <input
          type="password"
          autoComplete="current-password"
          aria-label="Passcode"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          className={cx(inputCls, 'w-full')}
          autoFocus
        />
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" disabled={busy || !passcode}>
          Sign in
        </Button>
      </form>
    </main>
  );
}

function Dashboard() {
  useDocumentTitle('Events | HouseCup admin');
  const { data, error } = useLoad<{ events: AdminEventDTO[] }>('/events');
  const active = data?.events.filter((e) => e.status === 'active') ?? [];
  const archived = data?.events.filter((e) => e.status === 'archived') ?? [];
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="wide text-3xl font-black">Events</h1>
          <p className="mt-1 text-muted">Create an event, print judge cards, and run the live show.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/api/admin/season/export.csv" className="inline-flex min-h-11 items-center rounded-xl bg-sunk px-4 font-semibold">
            Download Season Cup CSV
          </a>
          <Link to="/admin/events/new" className="press inline-flex min-h-11 items-center rounded-xl bg-ink px-4 font-semibold text-paper">
            New event
          </Link>
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {data && data.events.length === 0 && (
        <p className="rounded-xl bg-raise p-6">
          No events yet. Start by checking your <Link className="font-semibold underline" to="/admin/houses">school houses</Link>, then
          create your first event.
        </p>
      )}
      <EventList title="Running" events={active} />
      {archived.length > 0 && <EventList title="Archived" events={archived} />}
      <RefreshScreens />
    </div>
  );
}

/** After changing data outside the app (e.g. the pre-event wipe), push fresh scores to every screen. */
function RefreshScreens() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | string>('idle');
  return (
    <section className="flex flex-wrap items-center gap-3 border-t border-rule pt-4 text-sm text-muted">
      <Button
        variant="secondary"
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy');
          try {
            await adminApi('/republish', { method: 'POST' });
            setState('done');
          } catch (e) {
            setState(errorMessage(e));
          }
        }}
      >
        Refresh all live screens
      </Button>
      <span>
        {state === 'done'
          ? 'Done. Every scoreboard and TV now shows the latest data.'
          : state !== 'idle' && state !== 'busy'
            ? state
            : 'Use this after wiping or editing data directly in the database.'}
      </span>
    </section>
  );
}

function EventList({ title, events }: { title: string; events: AdminEventDTO[] }) {
  if (!events.length) return null;
  return (
    <section>
      <h2 className="semiwide mb-2 text-lg font-black">{title}</h2>
      <ul className="divide-y divide-rule border-y border-rule">
        {events.map((e) => {
          const leader = [...e.teams].sort((a, b) => b.total - a.total)[0];
          return (
            <li key={e.id}>
              <Link to={`/admin/events/${e.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 py-4 hover:bg-raise">
                <span className="min-w-0 flex-1">
                  <span className="semiwide block text-lg font-bold">{e.name}</span>
                  <span className="mt-1 block">
                    <StatusChips e={e} />
                  </span>
                </span>
                <span className="flex items-center gap-1" aria-label={`${e.teams.length} teams`}>
                  {e.teams.slice(0, 12).map((t) => (
                    <span key={t.id} className="h-5 w-2 rounded-full" style={{ background: t.color_hex }} />
                  ))}
                </span>
                <span className="text-sm text-muted">
                  {leader && leader.total !== 0 ? `${leader.name} leads with ${leader.total}` : 'No points yet'}
                </span>
                <span className="num text-sm">
                  PIN <strong className="text-base">{e.judge_pin}</strong>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
