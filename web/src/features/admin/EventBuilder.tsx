import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { TEAM_PALETTE } from '@housecup/shared/color';
import { deriveShortName } from '@housecup/shared/naming';
import type { AdminEventDTO, Category, HouseDTO, ThemeMode } from '@housecup/shared/types';
import { Button, Segmented, TeamTag, Toggle } from '../../components/ui.tsx';
import { errorMessage, HttpError } from '../../lib/api.ts';
import { useDocumentTitle } from '../../lib/theme.ts';
import { cx, uuid } from '../../lib/util.ts';
import { adminApi, BackLink, ColorPicker, ErrorNote, Field, HouseSelect, inputCls, useLoad } from './common.tsx';

interface DraftTeam {
  key: string;
  name: string;
  short: string;
  shortEdited: boolean;
  color: string;
  house_id: number | null;
}

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'sports', label: 'Sports' },
  { value: 'esports', label: 'Esports' },
  { value: 'chess', label: 'Chess' },
  { value: 'academic', label: 'Academic' },
  { value: 'general', label: 'General' },
];

const newTeam = (i: number): DraftTeam => ({
  key: uuid(),
  name: '',
  short: '',
  shortEdited: false,
  color: TEAM_PALETTE[i % TEAM_PALETTE.length]!,
  house_id: null,
});

/** Live auto-fill: every team without a hand-edited code gets a derived, unique one. */
function withShortNames(teams: DraftTeam[]): DraftTeam[] {
  const used = teams.filter((t) => t.shortEdited && t.short).map((t) => t.short.toUpperCase());
  return teams.map((t) => {
    if (t.shortEdited) return t;
    const short = t.name.trim() ? deriveShortName(t.name, used) : '';
    if (short) used.push(short);
    return { ...t, short };
  });
}

export function EventBuilder() {
  useDocumentTitle('New event | HouseCup admin');
  const navigate = useNavigate();
  const { data: housesData } = useLoad<{ houses: HouseDTO[] }>('/houses');
  const houses = housesData?.houses ?? [];
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('sports');
  const [theme, setTheme] = useState<ThemeMode>('daylight');
  const [season, setSeason] = useState(true);
  const [mode, setMode] = useState<'houses' | 'custom'>('houses');
  const [teams, setTeamsRaw] = useState<DraftTeam[]>(() => [newTeam(0), newTeam(1)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setTeams = (fn: (t: DraftTeam[]) => DraftTeam[]) => setTeamsRaw((cur) => withShortNames(fn(cur)));
  const update = (key: string, patch: Partial<DraftTeam>) => setTeams((ts) => ts.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const move = (i: number, dir: -1 | 1) =>
    setTeams((ts) => {
      const n = [...ts];
      const j = i + dir;
      if (j < 0 || j >= n.length) return ts;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!name.trim()) p.push('Give the event a name.');
    if (mode === 'houses' && houses.length < 2) p.push('Add at least 2 school houses first, or use custom teams.');
    if (mode === 'custom') {
      const named = teams.filter((t) => t.name.trim());
      if (named.length < 2) p.push('Add at least 2 teams.');
      const names = named.map((t) => t.name.trim().toLowerCase());
      if (new Set(names).size !== names.length) p.push('Team names must be different.');
    }
    return p;
  }, [name, mode, houses.length, teams]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        category,
        theme_mode: theme,
        counts_toward_season: season,
        teams:
          mode === 'houses'
            ? { mode: 'houses' }
            : {
                mode: 'custom',
                teams: teams
                  .filter((t) => t.name.trim())
                  .map((t) => ({
                    name: t.name.trim(),
                    short_name: t.short.trim() || undefined,
                    color_hex: t.color,
                    house_id: t.house_id,
                  })),
              },
      };
      const res = await adminApi<{ event: AdminEventDTO }>('/events', { json: body });
      navigate(`/admin/events/${res.event.id}`);
    } catch (err) {
      setError(err instanceof HttpError && err.code === 'VALIDATION' ? 'Check the team names and codes (codes: up to 4 letters or digits).' : errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <BackLink to="/admin">Events</BackLink>
        <h1 className="wide mt-2 text-3xl font-black">New event</h1>
      </div>

      <Field label="Event name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 80))}
          className={cx(inputCls, 'h-13 w-full text-lg font-semibold')}
          placeholder="e.g. Annual Sports Day"
          autoFocus
        />
      </Field>

      <div className="flex flex-wrap gap-x-8 gap-y-4">
        <div>
          <span className="text-sm font-semibold">Category</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-pressed={category === c.value}
                onClick={() => {
                  setCategory(c.value);
                  if (c.value === 'esports') setTheme('arena');
                }}
                className={cx(
                  'min-h-10 rounded-full border-2 px-3.5 text-sm font-semibold',
                  category === c.value ? 'border-ink bg-ink text-paper' : 'border-rule',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="text-sm font-semibold">Scoreboard theme</span>
          <div className="mt-1">
            <Segmented
              label="Scoreboard theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'daylight', label: 'Daylight (outdoors)' },
                { value: 'arena', label: 'Arena (indoors, dark)' },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="max-w-md">
        <Toggle checked={season} onChange={setSeason} label="Counts toward the Season Cup" hint="Points from house-linked teams add to the overall house totals." />
      </div>

      <section className="border-t-2 border-ink pt-4">
        <h2 className="semiwide text-xl font-black">Teams</h2>
        <div className="mt-3">
          <Segmented
            label="Team setup"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'houses', label: `Use school houses (${houses.length})` },
              { value: 'custom', label: 'Custom teams' },
            ]}
          />
        </div>

        {mode === 'houses' ? (
          <div className="mt-4">
            {houses.length === 0 ? (
              <p className="text-muted">No school houses yet. Add them under School houses, or switch to custom teams.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {houses.map((h) => (
                  <li key={h.id} className="flex items-center gap-2 rounded-xl border border-rule py-1.5 pr-3 pl-1.5">
                    <TeamTag color={h.color_hex} className="h-8 min-w-11 rounded-lg px-1.5 text-xs">
                      {h.short_name}
                    </TeamTag>
                    <span className="font-semibold">{h.name}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-sm text-muted">You can rename, recolor or add teams to this event later without affecting the houses.</p>
          </div>
        ) : (
          <div className="mt-4">
            <ol className="flex flex-col gap-2">
              {teams.map((t, i) => (
                <li key={t.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-rule p-2 sm:flex-nowrap">
                  <ColorPicker label={`Color for ${t.name || `team ${i + 1}`}`} value={t.color} onChange={(c) => update(t.key, { color: c })} />
                  <input
                    aria-label={`Team ${i + 1} name`}
                    value={t.name}
                    onChange={(e) => update(t.key, { name: e.target.value.slice(0, 40) })}
                    placeholder={`Team ${i + 1} name`}
                    className={cx(inputCls, 'min-w-40 flex-1 font-semibold')}
                  />
                  <input
                    aria-label={`Team ${i + 1} short code`}
                    title="Short code (auto-filled, editable)"
                    value={t.short}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 4).toUpperCase();
                      update(t.key, { short: v, shortEdited: v !== '' });
                    }}
                    placeholder="Code"
                    className={cx(inputCls, 'wide w-20 text-center font-black', !t.shortEdited && 'text-muted')}
                  />
                  {houses.length > 0 && (
                    <HouseSelect houses={houses} value={t.house_id} onChange={(v) => update(t.key, { house_id: v })} className="w-auto sm:w-44" />
                  )}
                  <span className="flex gap-1">
                    <Button variant="ghost" className="w-11 px-0" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </Button>
                    <Button variant="ghost" className="w-11 px-0" aria-label="Move down" disabled={i === teams.length - 1} onClick={() => move(i, 1)}>
                      ↓
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-11 px-0"
                      aria-label="Remove team"
                      disabled={teams.length <= 2}
                      onClick={() => setTeams((ts) => ts.filter((x) => x.key !== t.key))}
                    >
                      ✕
                    </Button>
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex items-center gap-3">
              <Button variant="secondary" disabled={teams.length >= 12} onClick={() => setTeams((ts) => [...ts, newTeam(ts.length)])}>
                Add team
              </Button>
              <span className="text-sm text-muted">{teams.length} of 12. Codes fill in automatically; type to override.</span>
            </div>
          </div>
        )}
      </section>

      <div className="flex flex-col gap-3 border-t border-rule pt-4">
        {problems.length > 0 && <p className="text-sm text-muted">{problems[0]}</p>}
        <ErrorNote>{error}</ErrorNote>
        <div>
          <Button disabled={busy || problems.length > 0} onClick={submit} className="min-h-13 px-6 text-lg">
            Create event
          </Button>
        </div>
      </div>
    </div>
  );
}
