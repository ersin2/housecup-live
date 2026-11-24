import { useEffect, useRef, useState, type ReactNode } from 'react';
import { onColor } from '@housecup/shared/color';
import { cx, haptic } from '../lib/util.ts';

/** Always dark-on-white with a quiet zone so it scans from projectors and dark themes alike. */
export function QrCode({ value, size = 160, className }: { value: string; size?: number; className?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    // Loaded on demand: only TV mode and admin pages draw QR codes.
    import('qrcode')
      .then((m) =>
        m.default.toString(value, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }),
      )
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(''));
    return () => {
      alive = false;
    };
  }, [value]);
  return (
    <div
      role="img"
      aria-label={`QR code for ${value}`}
      className={cx('bg-white [&>svg]:block [&>svg]:h-full [&>svg]:w-full', className)}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** Team color chip with automatic black/white text. */
export function TeamTag({ color, children, className }: { color: string; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx('wide inline-flex items-center justify-center font-black leading-none', className)}
      style={{ background: color, color: onColor(color) }}
    >
      {children}
    </span>
  );
}

export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={label}>
      <button aria-label="Close" className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className="hc-sheet-in safe-bottom relative w-full max-w-md rounded-t-3xl bg-white px-4 pt-3 text-black shadow-[0_-12px_40px_rgba(0,0,0,0.25)] outline-none"
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-neutral-300" />
        {children}
      </div>
    </div>
  );
}

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'back' | 'clear';

export function Keypad({ onKey, extraLeft }: { onKey: (k: KeypadKey) => void; extraLeft?: ReactNode }) {
  const keys: KeypadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const btn = 'press num h-16 rounded-2xl text-3xl font-extrabold active:bg-neutral-300 select-none';
  const tap = (k: KeypadKey) => {
    haptic();
    onKey(k);
  };
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k) => (
        <button key={k} type="button" className={cx(btn, 'bg-neutral-100')} onClick={() => tap(k)}>
          {k}
        </button>
      ))}
      {extraLeft ?? (
        <button type="button" className={cx(btn, 'bg-neutral-100 text-lg')} onClick={() => tap('clear')}>
          Clear
        </button>
      )}
      <button type="button" className={cx(btn, 'bg-neutral-100')} onClick={() => tap('0')}>
        0
      </button>
      <button type="button" aria-label="Delete digit" className={cx(btn, 'bg-neutral-100')} onClick={() => tap('back')}>
        ⌫
      </button>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cx('flex cursor-pointer items-center justify-between gap-4 py-3', disabled && 'opacity-50')}>
      <span>
        <span className="block font-semibold">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="h-8 w-14 rounded-full bg-sunk transition-colors peer-checked:bg-ink peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink" />
        <span className="absolute top-1 left-1 h-6 w-6 rounded-full bg-paper shadow transition-transform peer-checked:translate-x-6" />
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-sunk p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'min-h-10 rounded-lg px-4 text-sm font-semibold transition-colors',
            o.value === value ? 'bg-ink text-paper' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Button({
  children,
  variant = 'primary',
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const styles = {
    primary: 'bg-ink text-paper hover:opacity-90',
    secondary: 'bg-sunk text-ink hover:bg-rule',
    danger: 'bg-danger text-white hover:opacity-90',
    ghost: 'text-ink hover:bg-sunk',
  }[variant];
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'press inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-40',
        styles,
        className,
      )}
    >
      {children}
    </button>
  );
}
