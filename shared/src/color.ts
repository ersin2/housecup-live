// Color helpers: validation, WCAG contrast, and a vivid preset palette for team colors.

export const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export const TEAM_PALETTE = [
  '#E63946', // red
  '#1D4ED8', // blue
  '#F59E0B', // amber
  '#10B981', // emerald
  '#7C3AED', // violet
  '#0EA5E9', // sky
  '#EC4899', // pink
  '#F97316', // orange
  '#84CC16', // lime
  '#14B8A6', // teal
  '#6B7280', // slate
  '#111827', // ink
] as const;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text color to place on top of a team fill: whichever of black/white contrasts more. */
export function onColor(hex: string): '#000000' | '#FFFFFF' {
  return contrastRatio(hex, '#000000') >= contrastRatio(hex, '#FFFFFF') ? '#000000' : '#FFFFFF';
}

/** True when the color is hard to tell apart from the given background (Event Builder warning). */
export function isLowContrastOn(hex: string, background: string, min = 1.5): boolean {
  return contrastRatio(hex, background) < min;
}
