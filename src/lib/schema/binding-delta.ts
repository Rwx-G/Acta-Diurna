/**
 * Numeric delta computation for bound values (Epic 9, Story 9.4).
 *
 * A pure, isomorphic function that compares a bound numeric value to the same
 * value in the previous issue and produces the {@link BindingDelta} baked onto the
 * binding. It is the single authoritative source the publish-time bake calls, kept
 * here in the schema package (imports nothing from `$lib/server` or `$lib/ui`, the
 * same boundary as `series-diff.ts`) so the renderer's omit-when-absent rule and the
 * baker's compute rule can never drift on what counts as a comparable delta.
 *
 * The renderer never computes this: the delta is frozen onto the published snapshot
 * at publish time and read straight off the validated document, so the prior issue's
 * raw data never reaches the reader - only the precomputed delta does.
 *
 * Omit-rather-than-mislead is the load-bearing rule (the same posture as the
 * `data_as_of` caption): a value is comparable ONLY when both the current and the
 * prior value are finite numbers. A non-numeric value (a string KPI like "On track"),
 * a missing prior value (first issue, no id match, the prior block had no value), or a
 * non-finite number yields `undefined`, and the caller bakes no `delta` - never a
 * zero or fabricated movement.
 */
import type { BindingDelta, BindingDeltaDirection } from './blocks/shared.ts';

/**
 * A KPI value as it appears in a resolved item: a number for a numeric figure, a
 * string for a textual status. Only a finite number is comparable; anything else is
 * non-numeric and yields no delta.
 */
export type ComparableValue = number | string | null | undefined;

/** A finite number, or undefined when the value is not a comparable numeric figure. */
function asFiniteNumber(value: ComparableValue): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function directionOf(absolute: number): BindingDeltaDirection {
	if (absolute > 0) return 'up';
	if (absolute < 0) return 'down';
	return 'flat';
}

/**
 * Computes the {@link BindingDelta} of a current value against its prior-issue value,
 * or `undefined` when the pair is not comparable (the caller then bakes no delta and
 * the renderer omits the indicator). Both values must be finite numbers; a string or
 * missing value on either side is non-comparable by the omit-rather-than-mislead rule.
 *
 * `absolute` is the signed change (current minus prior). `relative` is the signed
 * fraction of the prior value, or null when the prior value is zero (a percentage
 * against a zero baseline is undefined, so the renderer shows the absolute change
 * alone rather than dividing by zero). `direction` is up / down / flat off the sign of
 * the absolute change, so an unchanged value reads `flat` (a real, truthful "no
 * movement"), distinct from a non-comparable pair which carries no delta at all.
 */
export function computeBindingDelta(
	current: ComparableValue,
	prior: ComparableValue
): BindingDelta | undefined {
	const now = asFiniteNumber(current);
	const before = asFiniteNumber(prior);
	if (now === undefined || before === undefined) return undefined;

	const absolute = now - before;
	const relative = before === 0 ? null : absolute / before;
	return {
		direction: directionOf(absolute),
		priorValue: before,
		absolute,
		relative
	};
}
