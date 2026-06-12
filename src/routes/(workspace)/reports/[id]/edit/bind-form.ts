/**
 * Parses the bind form's `slotMapping` field (a JSON object mapping field name
 * to a `BindingSlot`) and validates each slot against the schema. Invalid input
 * throws, and the action maps it to a 400 - the slot mapping is author-supplied
 * data crossing a trust boundary, so it is validated, not trusted.
 */
import { bindingSlotSchema, type BindingSlot } from '$lib/schema';

export type SlotMapping = Record<string, BindingSlot>;

export function parseSlotMapping(raw: string): SlotMapping {
	const parsed: unknown = JSON.parse(raw);
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new TypeError('Slot mapping must be an object.');
	}
	const mapping: SlotMapping = {};
	for (const [name, value] of Object.entries(parsed)) {
		mapping[name] = bindingSlotSchema.parse(value);
	}
	return mapping;
}
