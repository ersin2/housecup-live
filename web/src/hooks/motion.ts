import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Rolling count-up/down. Pair with the .num class so digits never jitter. */
export function useCountUp(value: number, duration = 900): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const shownRef = useRef(value);
  shownRef.current = shown;

  useEffect(() => {
    if (reduced || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = shownRef.current;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(Math.round(a + (value - a) * easeOut(t)));
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduced]);

  return shown;
}

/**
 * FLIP reordering: children marked with data-flip="<key>" glide from their previous
 * position whenever `orderKey` changes (e.g. one team overtakes another).
 */
export function useFlip<T extends HTMLElement>(orderKey: string, duration = 650) {
  const ref = useRef<T>(null);
  const prev = useRef(new Map<string, number>());
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const next = new Map<string, number>();
    root.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => {
      const key = el.dataset.flip!;
      const top = el.offsetTop;
      next.set(key, top);
      const before = prev.current.get(key);
      if (!reduced && before !== undefined && before !== top) {
        el.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], {
          duration,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        });
      }
    });
    prev.current = next;
  }, [orderKey, duration, reduced]);

  return ref;
}

/** Re-render on an interval (relative timestamps, staleness checks). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
