/**
 * Binding diagnostics (FR15, UX Flow B "the refill"): compare a report's bound
 * blocks against a FRESH data set's available field names and classify each
 * block's binding state - green (every bound field is present and rebinds),
 * amber (a field drifted: renamed or missing, with the closest-match remap
 * proposed), red (no bound field resolves at all). Pure: no DB, no DOM. The
 * route reads the report + the fresh data set's fields and calls this; the
 * shapes feed both the workspace chips (BindingChip/BindingSummary/
 * DiagnosticPanel) and the rebind service.
 *
 * "Bound fields" are the `binding.fields[]` that carry a `slot` - those are the
 * fields the resolver consumes, so those are the ones that must be present in
 * the fresh data set for a clean rebind. An unslotted field is a placeholder the
 * author has not mapped yet and never drives a drift.
 *
 * "Errors are guidance" (UX principle): a drift names the block, the expected
 * field, and the closest candidate among the fresh data set's fields, so the
 * remap is one click. The closest-match contract (Levenshtein + tie-break) lives
 * in `distance.ts`.
 */
import type { Block, DocumentV1, Section } from '$lib/schema';
import { closestField } from './distance.ts';

const BINDABLE_TYPES = new Set(['table', 'chart', 'kpi']);

/** A block's binding state against a fresh data set (the chip colours). */
export type BindingState = 'bound' | 'drifted' | 'unresolved';

/** One drifted field within a block: the expected name and its closest match. */
export interface FieldDrift {
	/** The bound field name the fresh data set no longer carries. */
	expected: string;
	/** The closest available field name to remap onto, or `null` if none exists. */
	closest: string | null;
	/** Edit distance to {@link closest}; omitted when there is no candidate. */
	distance?: number;
}

/** A per-block binding diagnostic the chip and panel render. */
export interface BlockDiagnostic {
	blockId: string;
	blockType: 'table' | 'chart' | 'kpi';
	/** Human label for the block (section title + type), for the chip and panel. */
	label: string;
	state: BindingState;
	/** Drifts on this block (empty when `state` is `bound`). */
	drifts: FieldDrift[];
}

/** Aggregate binding state across a report (the header BindingSummary). */
export interface BindingSummary {
	total: number;
	bound: number;
	drifted: number;
	unresolved: number;
	/** True when every bound block is green (the "all green" header state). */
	allGreen: boolean;
}

function isBindable(block: Block): block is Extract<Block, { type: 'table' | 'chart' | 'kpi' }> {
	return BINDABLE_TYPES.has(block.type);
}

function blockLabel(sectionTitle: string, blockType: string): string {
	return `${sectionTitle} - ${blockType}`;
}

/**
 * Diagnoses one block against the fresh data set's available field names.
 * Returns `null` when the block is not data-bound (no binding, or no slotted
 * fields), so the caller skips it. Otherwise classifies:
 *   - `bound`   : every slotted field name is present in the fresh data set.
 *   - `drifted` : at least one slotted field is absent, but not all - the
 *                 present fields would still rebind, the absent ones get a
 *                 closest-match proposal.
 *   - `unresolved` : NO slotted field is present (the data set is foreign).
 */
export function diagnoseBlock(
	block: Block,
	sectionTitle: string,
	availableFields: readonly string[]
): BlockDiagnostic | null {
	if (!isBindable(block) || block.binding === undefined) return null;

	const slottedFields = block.binding.fields.filter((field) => field.slot !== undefined);
	if (slottedFields.length === 0) return null;

	const availableSet = new Set(availableFields);
	const drifts: FieldDrift[] = [];
	let presentCount = 0;

	for (const field of slottedFields) {
		if (availableSet.has(field.name)) {
			presentCount += 1;
			continue;
		}
		const { candidate, distance } = closestField(field.name, availableFields);
		drifts.push(
			candidate === null
				? { expected: field.name, closest: null }
				: { expected: field.name, closest: candidate, distance }
		);
	}

	let state: BindingState;
	if (drifts.length === 0) {
		state = 'bound';
	} else if (presentCount === 0) {
		state = 'unresolved';
	} else {
		state = 'drifted';
	}

	return {
		blockId: block.id,
		blockType: block.type,
		label: blockLabel(sectionTitle, block.type),
		state,
		drifts
	};
}

/** Walks every section, diagnosing each data-bound block in document order. */
export function diagnoseDocument(
	document: DocumentV1,
	availableFields: readonly string[]
): BlockDiagnostic[] {
	const diagnostics: BlockDiagnostic[] = [];
	for (const section of document.sections as Section[]) {
		for (const block of section.blocks) {
			const diagnostic = diagnoseBlock(block, section.title, availableFields);
			if (diagnostic !== null) diagnostics.push(diagnostic);
		}
	}
	return diagnostics;
}

/** Aggregates per-block diagnostics into the header summary counts. */
export function summarize(diagnostics: readonly BlockDiagnostic[]): BindingSummary {
	const summary: BindingSummary = {
		total: diagnostics.length,
		bound: 0,
		drifted: 0,
		unresolved: 0,
		allGreen: false
	};
	for (const diagnostic of diagnostics) {
		if (diagnostic.state === 'bound') summary.bound += 1;
		else if (diagnostic.state === 'drifted') summary.drifted += 1;
		else summary.unresolved += 1;
	}
	summary.allGreen = summary.total > 0 && summary.bound === summary.total;
	return summary;
}
