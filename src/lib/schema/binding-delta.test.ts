import { describe, expect, it } from 'vitest';
import { computeBindingDelta } from './binding-delta.ts';

describe('computeBindingDelta', () => {
	it('reports an increase as direction up with the signed absolute and relative change', () => {
		const delta = computeBindingDelta(108, 100);
		expect(delta).toEqual({ direction: 'up', priorValue: 100, absolute: 8, relative: 0.08 });
	});

	it('reports a decrease as direction down with a negative absolute and relative', () => {
		const delta = computeBindingDelta(90, 120);
		expect(delta).toEqual({ direction: 'down', priorValue: 120, absolute: -30, relative: -0.25 });
	});

	it('reports an unchanged value as flat (a truthful zero movement, not an omission)', () => {
		const delta = computeBindingDelta(42, 42);
		expect(delta).toEqual({ direction: 'flat', priorValue: 42, absolute: 0, relative: 0 });
	});

	it('returns a null relative against a zero baseline (no percent, never divide by zero)', () => {
		const delta = computeBindingDelta(5, 0);
		expect(delta).toEqual({ direction: 'up', priorValue: 0, absolute: 5, relative: null });
	});

	it('omits the delta when there is no prior value (a first issue / no id match)', () => {
		expect(computeBindingDelta(100, undefined)).toBeUndefined();
		expect(computeBindingDelta(100, null)).toBeUndefined();
	});

	it('omits the delta when the current value is non-numeric (a string status KPI)', () => {
		expect(computeBindingDelta('On track', 100)).toBeUndefined();
	});

	it('omits the delta when the prior value is non-numeric', () => {
		expect(computeBindingDelta(100, 'On track')).toBeUndefined();
	});

	it('omits the delta when either value is a non-finite number', () => {
		expect(computeBindingDelta(Number.NaN, 100)).toBeUndefined();
		expect(computeBindingDelta(100, Number.POSITIVE_INFINITY)).toBeUndefined();
	});

	it('handles a negative-to-positive crossing as an up direction', () => {
		const delta = computeBindingDelta(10, -10);
		expect(delta).toEqual({ direction: 'up', priorValue: -10, absolute: 20, relative: -2 });
	});
});
