import type { MemorySearchResult } from "./store.js";

export const W_RELEVANCE = 1.0;
export const W_IMPORTANCE = 0.3;
const W_TOTAL = W_RELEVANCE + W_IMPORTANCE;

/**
 * Re-rank search results using additive scoring:
 *   final = (w_relevance * similarity + w_importance * importance) / w_total
 *
 * Normalized to [0, 1] so callers can display as a percentage.
 * minScore filter is applied BEFORE this function on raw similarity,
 * so irrelevant memories are already excluded.
 */
export function applyScoring(
  results: MemorySearchResult[],
): MemorySearchResult[] {
  return results
    .map((r) => ({
      ...r,
      score:
        (W_RELEVANCE * r.score + W_IMPORTANCE * r.entry.importance) / W_TOTAL,
    }))
    .sort((a, b) => b.score - a.score);
}

function l2Distance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Remove near-duplicate results. Iterates from highest to lowest score;
 * if a later result's vector is within `threshold` similarity of any
 * already-kept result, it's dropped.
 *
 * Must be called AFTER applyScoring (results should be sorted by score desc).
 */
export function deduplicateResults(
  results: MemorySearchResult[],
  threshold: number,
): MemorySearchResult[] {
  const kept: MemorySearchResult[] = [];

  for (const r of results) {
    const isDupe = kept.some((k) => {
      const dist = l2Distance(k.entry.vector, r.entry.vector);
      const sim = 1 / (1 + dist);
      return sim >= threshold;
    });
    if (!isDupe) kept.push(r);
  }

  return kept;
}
