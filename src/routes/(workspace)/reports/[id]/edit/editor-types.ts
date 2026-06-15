/**
 * Shared editor payload + context types (Epic 10.5).
 *
 * The bind / rebind / remap form actions and the client-side enhance callbacks
 * must agree on the data shape each action returns. Declaring those shapes ONCE
 * here - imported by both the action return (`+page.server.ts`) and the client
 * cast (the binding panels) - turns an action-shape change into a compile error
 * rather than a silently skipped reconcile (the old `as unknown` / ad-hoc casts
 * would have swallowed a renamed field).
 */
import type { DocumentV1 } from '$lib/schema';
import type { BindingSummary, BlockDiagnostic } from '$lib/server/ingestion';

/**
 * The dirty/saving guard a binding action calls before submitting (Epic 10.5):
 * given the enhance `cancel`, it returns false (and cancels) when the editor has
 * unsaved edits in flight - a binding reconcile would otherwise overwrite them -
 * or true to proceed. Owned by ReportEditor (it reads `dirty` / `saving`).
 */
export type BindingGuard = (cancel: () => void) => boolean;

/** The `?/bind` action result: the re-resolved document + its new timestamp. */
export interface BindActionResult {
	boundAt: string;
	document: DocumentV1;
}

/** The `?/rebind` action result: the re-resolved document + diagnostics + summary. */
export interface RebindActionResult {
	reboundAt: string;
	document: DocumentV1;
	diagnostics: BlockDiagnostic[];
	summary: BindingSummary;
	rebound: string[];
}

/** The `?/remap` action result: the re-resolved document + its new timestamp. */
export interface RemapActionResult {
	remappedAt: string;
	document: DocumentV1;
}

/**
 * The per-block binding diagnostics context (Epic 10.5), threaded as one prop
 * from ReportEditor through SectionEditor (a clean single-object pass-through) to
 * BlockEditor, instead of three sibling props that are always populated, threaded
 * and cleared together. `byBlock` is keyed by block id (drifted/unresolved only);
 * `fields` are the rebind source's available columns for the inline remap pick;
 * `dataSetId` is the rebind source's id.
 */
export interface DiagnosticContext {
	byBlock: Map<string, BlockDiagnostic>;
	fields: string[];
	dataSetId: string | null;
}
