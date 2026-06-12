/**
 * String distance for binding diagnostics (FR15): when a fresh data set has a
 * renamed field, the diagnostic proposes the CLOSEST available field name so the
 * author's remap is one click ("errors are guidance"). Hand-written Levenshtein
 * - a dozen lines beats a runtime dependency for this.
 *
 * Pure, deterministic: the same expected name against the same ordered candidate
 * list always yields the same pick. The tie-break is documented on
 * {@link closestField}.
 */

/**
 * Levenshtein edit distance (insert/delete/substitute, cost 1 each) between two
 * strings. Two-row dynamic programming, O(a.length * b.length) time and O(b)
 * space. Case-sensitive by design: a header that differs only in case
 * (`Severity` vs `severity`) is distance 1, a near match the author still
 * confirms, never a silent auto-accept.
 */
export function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	let current = new Array<number>(b.length + 1);

	for (let i = 1; i <= a.length; i += 1) {
		current[0] = i;
		for (let j = 1; j <= b.length; j += 1) {
			const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(
				current[j - 1] + 1, // insertion
				previous[j] + 1, // deletion
				previous[j - 1] + substitutionCost // substitution
			);
		}
		[previous, current] = [current, previous];
	}
	return previous[b.length];
}

export interface ClosestMatch {
	/** The closest available field name, or `null` when no candidate exists. */
	candidate: string | null;
	/** The edit distance to {@link candidate}; `Infinity` when there is none. */
	distance: number;
}

/**
 * Picks the closest candidate among `available` to the `expected` field name.
 *
 * Tie-break (deterministic, documented contract):
 *   1. Lowest edit distance wins. An exact match (distance 0) therefore always
 *      beats any near match.
 *   2. On equal distance, the candidate appearing FIRST in `available` wins
 *      (lowest index). `available` is the data set's declared field order, so
 *      the pick is stable and meaningful, never random.
 *
 * Edge cases:
 *   - empty `available` -> `{ candidate: null, distance: Infinity }`.
 *   - multiple equidistant candidates -> the lowest-index one (rule 2).
 */
export function closestField(expected: string, available: readonly string[]): ClosestMatch {
	let best: ClosestMatch = { candidate: null, distance: Infinity };
	for (const name of available) {
		const distance = levenshtein(expected, name);
		// Strict `<` keeps the FIRST candidate at a given distance: a later
		// equidistant name never displaces an earlier one (tie-break rule 2).
		if (distance < best.distance) {
			best = { candidate: name, distance };
		}
	}
	return best;
}
