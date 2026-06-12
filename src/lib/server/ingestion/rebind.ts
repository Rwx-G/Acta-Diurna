/**
 * Automatic rebinding (FR14) and remap-in-place (FR15), the write side of "the
 * refill" (UX Flow B). Builds directly on the 2.4 binding-slot contract: every
 * bound block's slot mapping is fully recoverable from `block.binding.fields[]
 * .slot`, so a refill needs NO extra state - just the fresh data set's fields +
 * rows and the recovered mapping, fed back through `applyBinding`.
 *
 *   rebindReport  - inject a fresh data set: re-resolve every bound block whose
 *                   bound fields are all present in the fresh data, leave drifted
 *                   blocks untouched, and report a per-block diagnostic + summary.
 *   remapField    - from a diagnostic, point one expected field at an available
 *                   field; the binding's `fields[].name` is rewritten and the
 *                   block re-resolves. The remap persists in the document.
 *
 * Both target DRAFTS: `updateReportDocument` refuses a published report (409),
 * so a refill on a published report is a clean conflict, never a silent skip.
 */
import type { Binding, DocumentV1 } from '$lib/schema';
import { isBindable } from '$lib/schema';
import { getReport, updateReportDocument, type Report } from '$lib/server/documents/reports';
import type { DataSetField } from '$lib/server/db/schema';
import { AppError } from '$lib/server/problem';
import { applyBinding, type SlotMapping } from './bind.ts';
import {
	diagnoseDocument,
	summarize,
	type BindingSummary,
	type BlockDiagnostic
} from './diagnostics.ts';
import { ParseError, unparseable } from './errors.ts';
import { getDataSet, readDataSetTable } from './queries.ts';
import type { DataRow } from './resolve.ts';

/** The outcome of a refill: the updated report plus the glanceable state. */
export interface RebindResult {
	report: Report;
	diagnostics: BlockDiagnostic[];
	summary: BindingSummary;
	/** Block ids that re-resolved with the fresh data (the green ones). */
	rebound: string[];
}

/**
 * Recovers the slot mapping a bound block was built with: each slotted binding
 * field, keyed by field name. This is the 2.4 contract's promise - the mapping
 * lives in the persisted binding, so auto-rebind reads it straight back rather
 * than storing it separately.
 */
function recoverSlotMapping(binding: Binding): SlotMapping {
	const mapping: SlotMapping = {};
	for (const field of binding.fields) {
		if (field.slot !== undefined) mapping[field.name] = field.slot;
	}
	return mapping;
}

/** The bound field names a block needs present in the fresh data to rebind. */
function boundFieldNames(binding: Binding): string[] {
	return binding.fields.filter((field) => field.slot !== undefined).map((field) => field.name);
}

/**
 * Re-resolves every bound block whose bound fields all appear (by name) in the
 * fresh data set, in place, with the recovered slot mapping and the new rows. A
 * block missing any bound field is left exactly as it was - the diagnostic names
 * the drift so the author remaps it. Returns the mutated document and the ids
 * that re-resolved. Pure over its inputs (the document is cloned by the caller).
 */
function rebindDocument(
	document: DocumentV1,
	dataSetId: string,
	fields: readonly DataSetField[],
	rows: readonly DataRow[]
): string[] {
	const available = new Set(fields.map((field) => field.name));
	const rebound: string[] = [];

	for (const section of document.sections) {
		section.blocks = section.blocks.map((block) => {
			if (!isBindable(block) || block.binding === undefined) return block;
			const needed = boundFieldNames(block.binding);
			if (needed.length === 0) return block;
			// A field the fresh data set lacks is a drift: leave the block as-is so
			// its last-good data survives and the diagnostic drives the remap.
			if (!needed.every((name) => available.has(name))) return block;

			const mapping = recoverSlotMapping(block.binding);
			try {
				const bound = applyBinding(block, dataSetId, fields, mapping, rows);
				rebound.push(block.id);
				return bound;
			} catch (error) {
				// A coherent-on-old-data mapping that the fresh data makes incoherent
				// (e.g. a y series whose values are no longer numeric) is author-facing
				// drift, surfaced as 422, not a 500.
				if (error instanceof ParseError) throw unparseable(error);
				throw error;
			}
		});
	}
	return rebound;
}

/**
 * Injects a fresh data set into a report (FR14): auto-rebinds every bound block
 * whose fields match the fresh data, writes the result through the draft
 * validate-on-write path, and returns the per-block diagnostics + the aggregate
 * summary for the chips. Blocks whose fields drifted are reported (amber/red)
 * and left untouched until the author remaps them.
 *
 * The fresh data set's fields drive both the rebind (matching by name) and the
 * diagnostics (closest-match for the absent ones), so one read serves both.
 */
export async function rebindReport(reportId: string, dataSetId: string): Promise<RebindResult> {
	const dataSet = await getDataSet(dataSetId);
	const table = await readDataSetTable(dataSetId);
	const report = await getReport(reportId);

	const available = dataSet.fields.map((field) => field.name);
	const document = structuredClone(report.document);
	const rebound = rebindDocument(document, dataSetId, dataSet.fields, table.rows);

	// Persist only when something actually re-resolved; a refill that matches
	// nothing must not churn the draft's updatedAt or risk a 409 on a published
	// report when there was no work to do.
	const persisted = rebound.length > 0 ? await updateReportDocument(reportId, document) : report;

	const diagnostics = diagnoseDocument(persisted.document, available);
	return { report: persisted, diagnostics, summary: summarize(diagnostics), rebound };
}

function blockNotFound(): AppError {
	return new AppError({
		status: 404,
		title: 'Block not found',
		type: '/problems/block-not-found',
		detail: 'No block in this report matches the requested id.'
	});
}

function fieldNotFound(detail: string): AppError {
	return new AppError({
		status: 404,
		title: 'Binding field not found',
		type: '/problems/binding-field-not-found',
		detail
	});
}

/**
 * 409 conflict for a remap that would point two of a block's bound fields at the
 * same available field. The slot mapping is keyed by field name, so two slots on
 * one name silently drops a slot; this surfaces the collision as a clean conflict
 * (the same realm as `updateReportDocument`'s published-report 409), never a
 * silent loss.
 */
function fieldAlreadyBound(detail: string): AppError {
	return new AppError({
		status: 409,
		title: 'Field already bound',
		type: '/problems/field-already-bound',
		detail
	});
}

/**
 * Remap-in-place (FR15): rename one of a block's bound fields to an available
 * field name and re-resolve against the fresh data set. The binding's
 * `fields[].name` is rewritten (the slot - the role - is preserved), so the
 * remap PERSISTS in the document. 404 if the block or the expected field is not
 * found, or if `availableField` is absent from the fresh data set; 409 if it
 * collides with another bound field on the block; 422 if the remapped mapping is
 * incoherent for the block type.
 *
 * The remap reuses `bindBlock`'s write path semantics: the data set is read, the
 * slot mapping recovered from the (now corrected) binding, and the document
 * written through `updateReportDocument`.
 */
export async function remapField(
	reportId: string,
	blockId: string,
	dataSetId: string,
	expectedField: string,
	availableField: string
): Promise<Report> {
	const dataSet = await getDataSet(dataSetId);
	const table = await readDataSetTable(dataSetId);
	const report = await getReport(reportId);

	const document = structuredClone(report.document);
	for (const section of document.sections) {
		const index = section.blocks.findIndex((block) => block.id === blockId);
		if (index === -1) continue;

		const block = section.blocks[index];
		if (!isBindable(block) || block.binding === undefined) throw blockNotFound();

		const target = block.binding.fields.find((field) => field.name === expectedField);
		if (target === undefined || target.slot === undefined) {
			throw fieldNotFound(`No bound field "${expectedField}" on this block to remap.`);
		}

		// The remap endpoint is a real boundary: the UI <select> only constrains the
		// happy path, so a tampered POST can name a field the fresh data set lacks.
		// Without this guard buildBinding silently drops the unknown name and the
		// block re-resolves with a dropped column - the diagnostic promised an
		// actionable error, not silent data loss.
		if (!dataSet.fields.some((field) => field.name === availableField)) {
			throw fieldNotFound(`No field "${availableField}" in the fresh data set to remap onto.`);
		}

		// Two of this block's slotted fields keyed on one name collide in the slot
		// mapping and the second assignment silently wins, dropping a slot. Reject
		// the remap before mutating.
		const collides = block.binding.fields.some(
			(field) =>
				field.slot !== undefined && field.name === availableField && field.name !== expectedField
		);
		if (collides) {
			throw fieldAlreadyBound(`Field "${availableField}" is already bound on this block.`);
		}

		// Rewrite the name to the available field; the slot (role/key/order) is the
		// author's intent and is preserved. buildBinding rebuilds from the fresh
		// data set's fields, so the recovered mapping must key by the NEW name.
		const mapping = recoverSlotMapping(block.binding);
		delete mapping[expectedField];
		mapping[availableField] = target.slot;

		try {
			section.blocks[index] = applyBinding(block, dataSetId, dataSet.fields, mapping, table.rows);
		} catch (error) {
			if (error instanceof ParseError) throw unparseable(error);
			throw error;
		}
		return updateReportDocument(reportId, document);
	}
	throw blockNotFound();
}
