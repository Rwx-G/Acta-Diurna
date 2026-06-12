import { describe, expect, it } from 'vitest';
import { closestField, levenshtein } from './distance.ts';

describe('levenshtein', () => {
	it('is zero for identical strings', () => {
		expect(levenshtein('severity', 'severity')).toBe(0);
	});

	it('counts a single substitution', () => {
		expect(levenshtein('severity', 'severitz')).toBe(1);
	});

	it('counts an insertion and a deletion', () => {
		expect(levenshtein('count', 'counts')).toBe(1);
		expect(levenshtein('counts', 'count')).toBe(1);
	});

	it('equals the other length when one string is empty', () => {
		expect(levenshtein('', 'week')).toBe(4);
		expect(levenshtein('week', '')).toBe(4);
		expect(levenshtein('', '')).toBe(0);
	});

	it('is case-sensitive (a case-only difference is distance 1)', () => {
		expect(levenshtein('Severity', 'severity')).toBe(1);
	});

	it('measures the classic kitten/sitting distance of 3', () => {
		expect(levenshtein('kitten', 'sitting')).toBe(3);
	});

	it('is symmetric', () => {
		expect(levenshtein('criticality', 'severity')).toBe(levenshtein('severity', 'criticality'));
	});
});

describe('closestField', () => {
	it('returns an exact match at distance 0 (exact beats near)', () => {
		expect(closestField('severity', ['count', 'severity', 'sevirity'])).toEqual({
			candidate: 'severity',
			distance: 0
		});
	});

	it('proposes the field with the minimum edit distance', () => {
		// "sevirity" (distance 1) is the closest survivor to the expected
		// "severity", beating the unrelated "criticality" and "count".
		const match = closestField('severity', ['criticality', 'count', 'sevirity']);
		expect(match.candidate).toBe('sevirity');
		expect(match.distance).toBe(1);
	});

	it('returns a null candidate when no fields are available', () => {
		expect(closestField('severity', [])).toEqual({ candidate: null, distance: Infinity });
	});

	it('breaks ties by lowest index (first equidistant candidate wins)', () => {
		// Both "aaa" and "bbb" are distance 3 from "ccc"; the first in order wins.
		expect(closestField('ccc', ['aaa', 'bbb']).candidate).toBe('aaa');
		// Reversing the available order flips the deterministic pick.
		expect(closestField('ccc', ['bbb', 'aaa']).candidate).toBe('bbb');
	});

	it('prefers a strictly closer later candidate over an earlier farther one', () => {
		// "sevej" (distance 2) must beat "zzzzzzzz" (distance 8) despite order.
		expect(closestField('sever', ['zzzzzzzz', 'sevej']).candidate).toBe('sevej');
	});
});
