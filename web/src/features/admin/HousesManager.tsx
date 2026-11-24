import { useState } from 'react';
import { TEAM_PALETTE } from '@housecup/shared/color';
import { deriveShortName } from '@housecup/shared/naming';
import type { HouseDTO } from '@housecup/shared/types';
import { Button } from '../../components/ui.tsx';
import { errorMessage } from '../../lib/api.ts';
import { useDocumentTitle } from '../../lib/theme.ts';
import { cx } from '../../lib/util.ts';
import { adminApi, ColorPicker, ErrorNote, inputCls, useLoad } from './common.tsx';

export function HousesManager() {
  useDocumentTitle('School houses | HouseCup admin');
  const { data, error, reload } = useLoad<{ houses: HouseDTO[] }>('/houses');
  const [sync, setSync] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const houses = data?.houses ?? [];
  const [draft, setDraft] = useState({ name: '', color_hex: TEAM_PALETTE[0] as string });

  const call = async (path: string, init: Parameters<typeof adminApi>[1]) => {
    setMsg(null);
    try {
      await adminApi(path, init);
      await reload();
      return true;
    } catch (e) {
      setMsg(errorMessage(e));
      return false;
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    const ids = houses.map((h) => h.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void call('/houses/order', { method: 'PUT', json: { ids } });
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="wide text-3xl font-black">School houses</h1>
        <p className="mt-1 text-muted">
          Your permanent houses. Events can import them in one tap, and their points add up in the Season Cup.
        </p>
      </div>
      <ErrorNote>{error ?? msg}</ErrorNote>
      <label className="flex items-center gap-3">
        <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} className="h-5 w-5 accent-black" />
        <span>Apply name, code and color changes to these houses’ teams in running events</span>
      </label>

      <ol className="flex flex-col gap-2">
        {houses.map((h, i) => (
          <HouseRow key={`${h.id}:${h.name}:${h.short_name}:${h.color_hex}`} house={h} index={i} count={houses.length} sync={sync} call={call} move={move} />
        ))}
      </ol>

      <form
        className="flex flex-wrap items-center gap-2 border-t border-rule pt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await call('/houses', { json: { name: draft.name.trim(), color_hex: draft.color_hex } })) {
            setDraft({ name: '', color_hex: TEAM_PALETTE[(houses.length + 1) % TEAM_PALETTE.length]! });
          }
        }}
      >
        <ColorPicker label="New house color" value={draft.color_hex} onChange={(c) => setDraft((d) => ({ ...d, color_hex: c }))} />
        <input
          aria-label="New house name"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value.slice(0, 40) }))}
          placeholder="House name"
          className={cx(inputCls, 'w-full max-w-xs')}
        />
        <span className="wide w-14 text-center font-black text-muted">{draft.name.trim() ? deriveShortName(draft.name, houses.map((h) => h.short_name)) : ''}</span>
        <Button type="submit" variant="secondary" disabled={!draft.name.trim()}>
          Add house
        </Button>
      </form>
    </div>
  );
}

function HouseRow({
  house,
  index,
  count,
  sync,
  call,
  move,
}: {
  house: HouseDTO;
  index: number;
  count: number;
  sync: boolean;
  call: (path: string, init: Parameters<typeof adminApi>[1]) => Promise<boolean>;
  move: (i: number, d: -1 | 1) => void;
}) {
  const [d, setD] = useState({ name: house.name, short_name: house.short_name, color_hex: house.color_hex });
  const dirty = d.name !== house.name || d.short_name !== house.short_name || d.color_hex !== house.color_hex;
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-rule p-2 sm:flex-nowrap">
      <ColorPicker label={`Color for ${house.name}`} value={d.color_hex} onChange={(c) => setD((x) => ({ ...x, color_hex: c }))} />
      <input aria-label="House name" value={d.name} onChange={(e) => setD((x) => ({ ...x, name: e.target.value.slice(0, 40) }))} className={cx(inputCls, 'flex-1 font-semibold')} />
      <input
        aria-label="Short code"
        value={d.short_name}
        onChange={(e) => setD((x) => ({ ...x, short_name: e.target.value.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 4).toUpperCase() }))}
        className={cx(inputCls, 'wide w-20 text-center font-black')}
      />
      {dirty ? (
        <Button
          disabled={!d.name.trim() || !d.short_name}
          onClick={() => call(`/houses/${house.id}`, { method: 'PATCH', json: { ...d, name: d.name.trim(), sync_teams: sync } })}
        >
          Save
        </Button>
      ) : (
        <span className="flex gap-1">
          <Button variant="ghost" className="w-11 px-0" aria-label={`Move ${house.name} up`} disabled={index === 0} onClick={() => move(index, -1)}>
            ↑
          </Button>
          <Button variant="ghost" className="w-11 px-0" aria-label={`Move ${house.name} down`} disabled={index === count - 1} onClick={() => move(index, 1)}>
            ↓
          </Button>
          <Button
            variant="ghost"
            className="w-11 px-0"
            aria-label={`Delete ${house.name}`}
            onClick={() => confirm(`Delete ${house.name}?`) && call(`/houses/${house.id}`, { method: 'DELETE' })}
          >
            ✕
          </Button>
        </span>
      )}
    </li>
  );
}
