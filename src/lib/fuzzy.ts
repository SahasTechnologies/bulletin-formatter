/**
 * Lightweight fuzzy matcher used by the home-screen search.
 *
 * A query like "hist cre" matches "Historical Creative Writing Notes":
 * every whitespace-separated query word must appear in the target in order,
 * each as an in-order subsequence of characters. Scoring prefers word-boundary
 * and consecutive matches over scattered ones, and a small stem table lets
 * "historic" also match "History".
 */

export interface FuzzyMatch {
  /** Higher is better; only comparable within the same target length. */
  score: number;
  /** Sorted indices into the matched target string. */
  positions: number[];
}

export interface MatchField {
  text: string;
  /** Relative importance (1 = title, ~0.5 = subtitle, ~0.2 = body text). */
  weight: number;
}

export interface FieldedMatch {
  score: number;
  /** Match positions per field, in the same order as the fields passed in. */
  positions: number[][];
}

const isAlnum = (ch: string) => /[a-z0-9]/i.test(ch);

/** Suffix rewrites applied when a strict match fails (light stemming). */
const STEMS: [RegExp, string][] = [
  [/ically$/, ''],
  [/ing$/, ''],
  [/ies$/, 'y'],
  [/ed$/, ''],
  [/es$/, ''],
  [/ly$/, ''],
  [/ic$/, ''],
  [/al$/, ''],
  [/s$/, ''],
  [/y$/, ''],
];

function stemVariants(word: string): string[] {
  if (word.length < 4) return [];
  const out: string[] = [];
  for (const [re, replacement] of STEMS) {
    if (re.test(word)) {
      const stem = word.replace(re, replacement);
      if (stem.length >= 3) out.push(stem);
    }
  }
  return out;
}

/**
 * Best in-order subsequence occurrence of `word` in `target` at index >= from.
 * Uses memoised recursion so the highest-scoring occurrence wins (a word-boundary
 * run beats the same letters scattered through the string).
 */
function matchWord(word: string, target: string, from: number): FuzzyMatch | null {
  const lw = word.toLowerCase();
  const lt = target.toLowerCase();
  if (!lw.length || lw.length > lt.length - from) return null;

  // Cheap reject: every query char must exist, in order, somewhere after `from`.
  let probe = from;
  for (let i = 0; i < lw.length; i++) {
    probe = lt.indexOf(lw[i], probe);
    if (probe === -1) return null;
    probe++;
  }

  const memo = new Map<number, FuzzyMatch | null>();
  const best = (wi: number, tj: number): FuzzyMatch | null => {
    if (wi === lw.length) return { score: 0, positions: [] };
    const key = wi * (lt.length + 1) + tj;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;

    let out: FuzzyMatch | null = null;
    for (let j = tj; j < lt.length; j++) {
      if (lt[j] !== lw[wi]) continue;
      const rest = best(wi + 1, j + 1);
      if (!rest) continue;
      const atBoundary = j === 0 || !isAlnum(lt[j - 1]);
      let s = 10;
      if (atBoundary) s += 15;
      if (rest.positions.length && rest.positions[0] === j + 1) s += 8;
      else if (rest.positions.length) s -= Math.min(6, (rest.positions[0] - j - 1) * 0.75);
      const total = s + rest.score;
      if (!out || total > out.score) out = { score: total, positions: [j, ...rest.positions] };
    }
    memo.set(key, out);
    return out;
  };

  return best(0, from);
}

/**
 * Match a whole (possibly multi-word) query against a single target string.
 * Query words must match left-to-right; each word may fall back to a stemmed
 * variant (with a small penalty) when the strict form is not present.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return null;

  let score = 0;
  const positions: number[] = [];
  let from = 0;

  for (const word of words) {
    let m = matchWord(word, target, from);
    if (!m) {
      // Fall back to light stemming, e.g. "historic" -> "histor" so it can
      // match "History". Stemmed matches rank slightly below strict ones.
      let stemScore = -Infinity;
      let stemMatch: FuzzyMatch | null = null;
      for (const stem of stemVariants(word)) {
        const sm = matchWord(stem, target, from);
        if (sm && sm.score > stemScore) {
          stemScore = sm.score;
          stemMatch = sm;
        }
      }
      if (!stemMatch) return null;
      m = { score: stemMatch.score - 3, positions: stemMatch.positions };
    }
    score += m.score;
    positions.push(...m.positions);
    from = positions[positions.length - 1] + 1;
  }

  return { score, positions };
}

/**
 * Match a query against several weighted fields (title, subtitle, body…).
 * The fields are searched as one string so a multi-word query can span them
 * ("report luxe" -> title "Report", subtitle "Luxe"); scores are nudged by the
 * field weights so title hits outrank body hits.
 */
export function fuzzyMatchFields(query: string, fields: MatchField[]): FieldedMatch | null {
  if (!fields.length) return null;

  let combined = '';
  const starts: number[] = [];
  for (const f of fields) {
    starts.push(combined.length + (combined ? 1 : 0));
    if (combined) combined += '\n';
    combined += f.text;
  }
  const ends = fields.map((f, i) => starts[i] + f.text.length);

  const m = fuzzyMatch(query, combined);
  if (!m) return null;

  const fieldOf = (p: number) => starts.findIndex((s, i) => p >= s && p < ends[i]);
  const bonus = m.positions.reduce((acc, p) => acc + (fields[fieldOf(p)]?.weight ?? 1) - 1, 0);

  return {
    score: m.score + bonus,
    positions: fields.map((_, i) =>
      m.positions.filter((p) => p >= starts[i] && p < ends[i]).map((p) => p - starts[i]),
    ),
  };
}
