import { memo } from 'react';
import type { FeedItemDTO, StandingDTO } from '@housecup/shared/types';
import { TeamTag } from '../../components/ui.tsx';
import { useCountUp, useFlip } from '../../hooks/motion.ts';
import { ago, clock, cx, signed } from '../../lib/util.ts';

export function Score({ value, className }: { value: number; className?: string }) {
  const shown = useCountUp(value);
  return <span className={cx('num', className)}>{shown < 0 ? `−${Math.abs(shown)}` : shown}</span>;
}

/** The timing tower: rank, team block, name + progress bar, gap, total. */
export function Standings({
  standings,
  pulses,
  tv,
}: {
  standings: StandingDTO[];
  pulses: Record<number, number>;
  tv?: boolean;
}) {
  const ref = useFlip<HTMLOListElement>(standings.map((s) => s.team_id).join(','));
  const dense = standings.length > 6;
  // TV: scale rows so 2–12 teams always fill ~72% of the screen height without overflowing.
  const tvScale = Math.min(1.5, 72 / (Math.max(standings.length, 1) * 10.5));
  return (
    <ol
      ref={ref}
      style={tv ? { ['--s' as string]: tvScale } : undefined}
      className={cx('relative flex flex-col', tv ? 'gap-[calc(1.2vh*var(--s))]' : dense ? 'gap-1.5' : 'gap-2.5')}
    >
      {standings.map((s) => (
        <Lane key={s.team_id} s={s} pulse={pulses[s.team_id]} tv={tv} dense={dense} />
      ))}
    </ol>
  );
}

const Lane = memo(function Lane({
  s,
  pulse,
  tv,
  dense,
}: {
  s: StandingDTO;
  pulse: number | undefined;
  tv?: boolean;
  dense: boolean;
}) {
  const leader = s.rank === 1;
  const sizes = tv
    ? {
        row: 'min-h-[calc(9vh*var(--s))] gap-[1.4vw] px-[1vw] py-[calc(0.8vh*var(--s))]',
        rank: 'w-[3.2vw] text-[calc(3.4vh*var(--s))]',
        tag: 'h-[calc(7vh*var(--s))] w-[calc(9vh*var(--s))] text-[calc(2.6vh*var(--s))] rounded-[0.8vh]',
        name: 'text-[calc(3.6vh*var(--s))]',
        total: 'text-[calc(7vh*var(--s))]',
        gap: 'text-[calc(2.4vh*var(--s))]',
      }
    : dense
      ? {
          row: 'min-h-14 gap-3 px-3 py-2',
          rank: 'w-6 text-lg',
          tag: 'h-10 w-14 text-sm rounded-md',
          name: 'text-base',
          total: 'text-3xl',
          gap: 'text-sm',
        }
      : {
          row: 'min-h-18 gap-2.5 px-2.5 py-2.5 sm:min-h-20 sm:gap-4 sm:px-4 sm:py-3',
          rank: 'w-5 text-xl sm:w-7 sm:text-2xl',
          tag: 'h-12 w-14 text-base rounded-lg sm:h-14 sm:w-20 sm:text-xl',
          name: 'text-base sm:text-xl',
          total: 'text-[clamp(2.25rem,10vw,3.75rem)]',
          gap: 'text-sm sm:text-base',
        };

  return (
    <li
      data-flip={s.team_id}
      key={pulse}
      style={{ ['--team' as string]: s.color_hex }}
      className={cx(
        'relative flex items-center rounded-xl border border-rule bg-paper',
        leader && 'border-ink arena:border-[color-mix(in_srgb,var(--team)_60%,transparent)]',
        pulse !== undefined && 'hc-pulse',
        sizes.row,
      )}
    >
      <span className={cx('num shrink-0 text-center font-black', leader ? 'text-ink' : 'text-muted', sizes.rank)}>
        {s.rank}
      </span>
      <TeamTag color={s.color_hex} className={cx('team-glow shrink-0', sizes.tag, s.short_name.length > 3 && 'narrow tracking-tight')}>
        {s.short_name}
      </TeamTag>
      <span className="min-w-0 flex-1">
        <span className={cx('semiwide block truncate font-bold leading-tight', sizes.name)}>{s.name}</span>
        <span className={cx('mt-1.5 block overflow-hidden rounded-full bg-sunk', tv ? 'h-[0.9vh]' : 'h-1.5')}>
          <span
            className="block h-full rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${Math.max(s.total > 0 ? 2 : 0, s.bar_pct)}%`, background: s.color_hex }}
          />
        </span>
      </span>
      {!leader && (
        <span className={cx('num shrink-0 text-right font-semibold text-muted', sizes.gap)} aria-label={`${s.gap_to_leader} behind the leader`}>
          {s.gap_to_leader > 0 ? `−${s.gap_to_leader}` : '='}
        </span>
      )}
      <Score
        value={s.total}
        className={cx('min-w-[2ch] shrink-0 text-right font-black leading-none tracking-tight', sizes.total)}
      />
    </li>
  );
});

export function Feed({
  feed,
  teams,
  now,
  tv,
  limit = 8,
}: {
  feed: FeedItemDTO[];
  teams: Map<number, StandingDTO>;
  now: number;
  tv?: boolean;
  limit?: number;
}) {
  if (!feed.length) {
    return <p className={cx('text-muted', tv && 'text-[2.2vh]')}>Points will appear here as judges save them.</p>;
  }
  return (
    <ol className={cx('flex flex-col', tv ? 'gap-[1.4vh]' : 'gap-3')}>
      {feed.slice(0, limit).map((f) => (
        <li key={f.batch_id} className={cx('border-l-4 border-rule pl-3', tv && 'pl-[1vw]')}>
          <div className={cx('flex items-baseline justify-between gap-3', tv ? 'text-[2.3vh]' : 'text-[15px]')}>
            <span className="min-w-0 truncate font-bold">{f.label ?? 'Points awarded'}</span>
            <time className="num shrink-0 text-sm text-muted" dateTime={new Date(f.created_at).toISOString()} title={clock(f.created_at)}>
              {ago(f.created_at, now)}
            </time>
          </div>
          {f.event_name && <div className="text-sm text-muted">{f.event_name}</div>}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {f.awards.map((a) => {
              const t = teams.get(a.team_id);
              if (!t) return null;
              return (
                <span key={a.team_id} className="inline-flex items-stretch overflow-hidden rounded-md border border-rule">
                  <TeamTag color={t.color_hex} className={cx('px-1.5', tv ? 'text-[1.6vh]' : 'text-[11px]')}>
                    {t.short_name}
                  </TeamTag>
                  <span className={cx('num px-1.5 font-bold', tv ? 'text-[1.9vh]' : 'text-sm')}>{signed(a.points)}</span>
                </span>
              );
            })}
          </div>
        </li>
      ))}
    </ol>
  );
}

export interface Celebration {
  id: string;
  text: string;
  label: string | null;
  colors: string[];
}

export function Celebrations({ items, tv }: { items: Celebration[]; tv?: boolean }) {
  return (
    <div
      aria-live="polite"
      className={cx(
        'pointer-events-none fixed z-40 flex flex-col gap-2',
        tv ? 'top-[3vh] right-[2vw] w-[30vw]' : 'top-3 right-3 left-3 sm:left-auto sm:w-96',
      )}
    >
      {items.map((c) => (
        <div
          key={c.id}
          className={cx(
            'hc-slide-in flex items-center gap-3 overflow-hidden rounded-xl bg-ink text-paper shadow-2xl',
            tv ? 'p-[1.4vh] text-[2.6vh]' : 'p-3',
          )}
        >
          <span className="flex shrink-0 gap-1 self-stretch">
            {c.colors.slice(0, 4).map((col, i) => (
              <span key={i} className="w-2 rounded-full" style={{ background: col }} />
            ))}
          </span>
          <span className="min-w-0">
            <span className="semiwide block truncate font-black">{c.text}</span>
            {c.label && <span className="block truncate opacity-75">{c.label}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Ticker({ text, tv }: { text: string; tv?: boolean }) {
  const duration = Math.max(18, text.length * 0.35);
  return (
    <div
      className={cx('overflow-hidden border-t border-rule bg-raise', tv ? 'py-[1.2vh]' : 'py-2.5')}
      role="marquee"
      aria-label={text}
    >
      <div className="hc-ticker flex w-max whitespace-nowrap" style={{ ['--ticker-duration' as string]: `${duration}s` }}>
        {[0, 1].map((i) => (
          <span key={i} aria-hidden={i === 1} className={cx('semiwide pr-24 font-semibold', tv ? 'text-[2.6vh]' : 'text-base')}>
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}

export function FrozenBanner({ season, frozenAt, tv }: { season: boolean; frozenAt: number | null; tv?: boolean }) {
  return (
    <div
      role="status"
      className={cx(
        'flex items-center gap-4 rounded-xl border-2 border-ink bg-ink text-paper',
        tv ? 'px-[1.6vw] py-[1.6vh]' : 'px-4 py-3',
      )}
    >
      <svg aria-hidden viewBox="0 0 24 24" className={cx('shrink-0', tv ? 'h-[4vh] w-[4vh]' : 'h-7 w-7')} fill="currentColor">
        <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
      </svg>
      <div>
        <div className={cx('wide font-black', tv ? 'text-[3vh]' : 'text-lg')}>Mystery mode</div>
        <div className={cx('opacity-80', tv ? 'text-[2.2vh]' : 'text-sm')}>
          {season
            ? 'Some events are hidden until the reveal. Their latest points will appear then.'
            : `Scores are hidden until the reveal. Showing standings from ${frozenAt ? clock(frozenAt) : 'the freeze'}.`}
        </div>
      </div>
    </div>
  );
}
