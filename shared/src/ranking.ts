import type { StandingDTO } from './types.ts';

export interface RankInput {
  team_id: number;
  house_id: number | null;
  name: string;
  short_name: string;
  color_hex: string;
  total: number;
  sort_order: number;
}

/** Sort by total desc (sort_order breaks ties for display), assign competition ranks, gaps and bar widths. */
export function rankStandings(rows: RankInput[]): StandingDTO[] {
  const sorted = [...rows].sort((a, b) => b.total - a.total || a.sort_order - b.sort_order || a.team_id - b.team_id);
  const leader = sorted[0]?.total ?? 0;
  let prevTotal: number | null = null;
  let prevRank = 0;
  return sorted.map((r, i) => {
    const rank = prevTotal !== null && r.total === prevTotal ? prevRank : i + 1;
    prevTotal = r.total;
    prevRank = rank;
    const bar = leader > 0 ? Math.max(0, Math.round((r.total / leader) * 1000) / 10) : 0;
    return {
      team_id: r.team_id,
      house_id: r.house_id,
      name: r.name,
      short_name: r.short_name,
      color_hex: r.color_hex,
      total: r.total,
      rank,
      gap_to_leader: leader - r.total,
      bar_pct: bar,
      sort_order: r.sort_order,
    };
  });
}
