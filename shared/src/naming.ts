// Team short-code derivation, shared by the Event Builder (live preview) and the API
// (fallback when short_name is omitted). Produces 1–4 uppercase characters.

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

function words(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents: "Ébène" → "Ebene"
    .toUpperCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** "Phoenix" → "PHN", "Titans" → "TTN", "Grade 10 Strategists" → "G10S", "Team Alpha" → "TA". */
export function deriveShortName(name: string, taken: Iterable<string> = []): string {
  const parts = words(name);
  let base: string;

  if (parts.length === 0) {
    base = 'T';
  } else if (parts.length === 1) {
    const w = parts[0]!;
    if (/^\p{N}+$/u.test(w) || w.length <= 3) {
      base = w.slice(0, 4);
    } else {
      // First letter, then consonants, then remaining letters as filler.
      const first = w[0]!;
      const rest = [...w.slice(1)];
      const consonants = rest.filter((ch) => !VOWELS.has(ch));
      const others = rest.filter((ch) => VOWELS.has(ch));
      base = (first + consonants.join('') + others.join('')).slice(0, 3);
    }
  } else {
    base = parts.map((w) => (/^\p{N}+$/u.test(w) ? w : w[0]!)).join('').slice(0, 4);
  }

  const used = new Set([...taken].map((s) => s.toUpperCase()));
  if (!used.has(base)) return base;
  for (let i = 2; i <= 9; i++) {
    const candidate = base.slice(0, 3) + String(i);
    if (!used.has(candidate)) return candidate;
  }
  return base.slice(0, 2) + String(Math.floor(Math.random() * 90) + 10);
}

/** URL slug: lowercase ASCII letters, digits and single hyphens. */
export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
    .replace(/-+$/g, '');
  return s || 'event';
}
