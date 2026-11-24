import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { TEAM_PALETTE } from '@housecup/shared/color';
import type { AdminEventDTO, HouseDTO } from '@housecup/shared/types';
import { api, errorMessage } from '../../lib/api.ts';
import { cx } from '../../lib/util.ts';

export const adminApi = <T,>(path: string, init?: Parameters<typeof api>[1]) => api<T>(`/api/admin${path}`, init);

/** Tiny data hook: load, reload, error. */
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await adminApi<T>(path));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, setData, error, reload };
}

export function Panel({ title, children, actions, id }: { title: string; children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="border-t-2 border-ink pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id={id} className="semiwide text-xl font-black">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-sm text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'h-11 rounded-xl border-2 border-rule bg-paper px-3 text-base focus:border-ink focus:outline-none disabled:opacity-50';

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 font-semibold text-red-800">
      {children}
    </p>
  );
}

export function ColorPicker({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`${label}: ${value}. Change color`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="press h-11 w-11 rounded-xl border-2 border-ink/20"
        style={{ background: value }}
      />
      {open && (
        <div className="absolute top-12 left-0 z-20 w-64 rounded-2xl border border-rule bg-paper p-3 shadow-2xl">
          <div className="grid grid-cols-6 gap-2">
            {TEAM_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className={cx('h-8 w-8 rounded-lg', c === value.toUpperCase() && 'ring-3 ring-ink ring-offset-2 ring-offset-paper')}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="color"
              aria-label="Custom color"
              value={value}
              onChange={(e) => onChange(e.target.value.toUpperCase())}
              className="h-10 w-12 cursor-pointer rounded border-0 bg-transparent"
            />
            <input
              value={hex}
              onChange={(e) => {
                setHex(e.target.value);
                if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toUpperCase());
              }}
              aria-label="Hex color"
              className={cx(inputCls, 'h-10 w-full font-mono')}
              maxLength={7}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function StatusChips({ e }: { e: AdminEventDTO }) {
  const chip = 'rounded-full px-2.5 py-0.5 text-xs font-bold';
  return (
    <span className="flex flex-wrap gap-1.5">
      {e.status === 'archived' ? (
        <span className={cx(chip, 'bg-sunk text-muted')}>Archived</span>
      ) : (
        <span className={cx(chip, 'bg-green-100 text-green-900')}>Accepting scores</span>
      )}
      {e.is_featured && <span className={cx(chip, 'bg-ink text-paper')}>On the main screen</span>}
      {e.is_frozen && <span className={cx(chip, 'bg-amber-200 text-amber-950')}>Mystery mode</span>}
      {!e.counts_toward_season && <span className={cx(chip, 'border border-rule text-muted')}>Not in Season Cup</span>}
    </span>
  );
}

export function HouseSelect({
  houses,
  value,
  onChange,
  className,
}: {
  houses: HouseDTO[];
  value: number | null;
  onChange: (v: number | null) => void;
  className?: string;
}) {
  return (
    <select
      aria-label="Counts toward house"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className={cx(inputCls, className)}
    >
      <option value="">No house link</option>
      {houses.map((h) => (
        <option key={h.id} value={h.id}>
          Counts for {h.name}
        </option>
      ))}
    </select>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-sm font-semibold text-muted hover:text-ink">
      ← {children}
    </Link>
  );
}
