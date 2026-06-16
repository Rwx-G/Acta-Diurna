/**
 * Scale/entry key-rename cascade and reference discovery (in-editor Scales CRUD).
 *
 * A scale key and an entry key are REFERENCED by blocks elsewhere in the document
 * (see `validateScaleReferences` in `scales.ts` for the authoritative list of
 * reference sites). Renaming a key in the editor must therefore rewrite every
 * reference in lockstep, or the document fails the cross-reference validation. The
 * transforms here are the exact mirror of that validator: every site the validator
 * READS to flag a dangling reference, these functions WRITE to keep it resolved.
 *
 * Isomorphic and pure: imports no `$lib/server`/`$lib/ui`, mutates nothing in place
 * (each transform returns a fresh `structuredClone`), and is tolerant of a
 * transiently-invalid working copy (the same structural, `unknown`-typed stance the
 * validator takes, so it never throws on a half-edited document). The UI validates
 * the new key (slug shape + uniqueness) BEFORE calling a rename; these functions do
 * the mechanical rewrite only.
 */
import type { DocumentV1 } from './versions/v1.ts';

// Structural views over a block's scale/entry references, mirroring the per-type
// views in `scales.ts`. Local so this module imports no block schema value and stays
// tolerant of partially-typed working-copy blocks.
interface LegendView {
	scaleRef?: unknown;
}
interface ChipClusterView {
	scaleRef?: unknown;
	entries?: unknown[];
}
interface MatrixView {
	severityScale?: unknown;
	sourceScale?: unknown;
	findings?: Array<{ severity?: unknown; sources?: Record<string, unknown> }>;
}
interface TableView {
	columns?: Array<{ key?: unknown; scaleRef?: unknown }>;
	rows?: Array<Record<string, unknown>>;
}
interface TimelineView {
	milestones?: Array<{ status?: { scaleRef?: unknown; entry?: unknown } }>;
}

/** One place a scale or entry key is referenced, for the delete guard's message. */
export interface ScaleReference {
	sectionIndex: number;
	blockIndex: number;
	blockType: string;
	/** Where in the block the reference sits, e.g. `severityScale` or `finding 2 severity`. */
	via: string;
}

function forEachBlock(
	doc: DocumentV1,
	fn: (
		block: { type: string } & Record<string, unknown>,
		sectionIndex: number,
		blockIndex: number
	) => void
): void {
	doc.sections.forEach((section, sectionIndex) => {
		section.blocks.forEach((block, blockIndex) => {
			fn(block as unknown as { type: string } & Record<string, unknown>, sectionIndex, blockIndex);
		});
	});
}

/** Rebuilds `obj` with `oldKey` renamed to `newKey`, preserving insertion order. */
function renameObjectKey(
	obj: Record<string, unknown>,
	oldKey: string,
	newKey: string
): Record<string, unknown> {
	if (!Object.prototype.hasOwnProperty.call(obj, oldKey)) return obj;
	const next: Record<string, unknown> = {};
	for (const key of Object.keys(obj)) {
		next[key === oldKey ? newKey : key] = obj[key];
	}
	return next;
}

/**
 * Renames a scale's `key` from `oldKey` to `newKey` and rewrites every block that
 * references it: `legend.scaleRef`, `chip-cluster.scaleRef`,
 * `comparison-matrix.severityScale`/`.sourceScale`, `table.columns[].scaleRef`, and
 * `timeline.milestones[].status.scaleRef`. (`set-membership` references a block id,
 * not a scale key, so it is untouched.) Returns a fresh document; the input is not
 * mutated. A no-op when `oldKey === newKey`.
 */
export function renameScaleKey(doc: DocumentV1, oldKey: string, newKey: string): DocumentV1 {
	if (oldKey === newKey) return doc;
	const next = structuredClone(doc);
	for (const scale of next.scales ?? []) {
		if (scale.key === oldKey) scale.key = newKey;
	}
	forEachBlock(next, (block) => {
		switch (block.type) {
			case 'legend': {
				const view = block as unknown as LegendView;
				if (view.scaleRef === oldKey) view.scaleRef = newKey;
				break;
			}
			case 'chip-cluster': {
				const view = block as unknown as ChipClusterView;
				if (view.scaleRef === oldKey) view.scaleRef = newKey;
				break;
			}
			case 'comparison-matrix': {
				const view = block as unknown as MatrixView;
				if (view.severityScale === oldKey) view.severityScale = newKey;
				if (view.sourceScale === oldKey) view.sourceScale = newKey;
				break;
			}
			case 'table': {
				const view = block as unknown as TableView;
				for (const column of view.columns ?? []) {
					if (column.scaleRef === oldKey) column.scaleRef = newKey;
				}
				break;
			}
			case 'timeline': {
				const view = block as unknown as TimelineView;
				for (const milestone of view.milestones ?? []) {
					if (milestone.status && milestone.status.scaleRef === oldKey) {
						milestone.status.scaleRef = newKey;
					}
				}
				break;
			}
		}
	});
	return next;
}

/**
 * Renames an entry's `key` within the scale `scaleKey` from `oldEntry` to `newEntry`,
 * rewriting only the blocks that reference THAT scale: `chip-cluster.entries[]` (when
 * its `scaleRef` is `scaleKey`), `comparison-matrix.findings[].severity` (when
 * `severityScale` is `scaleKey`), `comparison-matrix.findings[].sources` object keys
 * (when `sourceScale` is `scaleKey`), `table` cell values under a column whose
 * `scaleRef` is `scaleKey`, and `timeline.milestones[].status.entry` (when its
 * `status.scaleRef` is `scaleKey`). Returns a fresh document; the input is not
 * mutated. A no-op when `oldEntry === newEntry`.
 */
export function renameEntryKey(
	doc: DocumentV1,
	scaleKey: string,
	oldEntry: string,
	newEntry: string
): DocumentV1 {
	if (oldEntry === newEntry) return doc;
	const next = structuredClone(doc);
	const scale = (next.scales ?? []).find((candidate) => candidate.key === scaleKey);
	if (scale) {
		for (const entry of scale.entries) {
			if (entry.key === oldEntry) entry.key = newEntry;
		}
	}
	forEachBlock(next, (block) => {
		switch (block.type) {
			case 'chip-cluster': {
				const view = block as unknown as ChipClusterView;
				if (view.scaleRef === scaleKey && Array.isArray(view.entries)) {
					view.entries = view.entries.map((entry) => (entry === oldEntry ? newEntry : entry));
				}
				break;
			}
			case 'comparison-matrix': {
				const view = block as unknown as MatrixView;
				const findings = view.findings ?? [];
				if (view.severityScale === scaleKey) {
					for (const finding of findings) {
						if (finding.severity === oldEntry) finding.severity = newEntry;
					}
				}
				if (view.sourceScale === scaleKey) {
					for (const finding of findings) {
						if (finding.sources)
							finding.sources = renameObjectKey(finding.sources, oldEntry, newEntry);
					}
				}
				break;
			}
			case 'table': {
				const view = block as unknown as TableView;
				const rows = view.rows ?? [];
				for (const column of view.columns ?? []) {
					if (column.scaleRef !== scaleKey || typeof column.key !== 'string') continue;
					const columnKey = column.key;
					for (const row of rows) {
						const cell = row[columnKey];
						if (cell !== undefined && cell !== null && cell !== '' && String(cell) === oldEntry) {
							row[columnKey] = newEntry;
						}
					}
				}
				break;
			}
			case 'timeline': {
				const view = block as unknown as TimelineView;
				for (const milestone of view.milestones ?? []) {
					const status = milestone.status;
					if (status && status.scaleRef === scaleKey && status.entry === oldEntry) {
						status.entry = newEntry;
					}
				}
				break;
			}
		}
	});
	return next;
}

/**
 * Every block that references the scale `scaleKey` (the delete guard's evidence: a
 * referenced scale must not be deleted, or its referrers become dangling). Mirrors
 * the scale-key reference sites of `renameScaleKey`.
 */
export function findScaleReferences(doc: DocumentV1, scaleKey: string): ScaleReference[] {
	const refs: ScaleReference[] = [];
	forEachBlock(doc, (block, sectionIndex, blockIndex) => {
		const push = (via: string): void => {
			refs.push({ sectionIndex, blockIndex, blockType: block.type, via });
		};
		switch (block.type) {
			case 'legend':
			case 'chip-cluster': {
				if ((block as unknown as LegendView).scaleRef === scaleKey) push('scaleRef');
				break;
			}
			case 'comparison-matrix': {
				const view = block as unknown as MatrixView;
				if (view.severityScale === scaleKey) push('severityScale');
				if (view.sourceScale === scaleKey) push('sourceScale');
				break;
			}
			case 'table': {
				const view = block as unknown as TableView;
				(view.columns ?? []).forEach((column, columnIndex) => {
					if (column.scaleRef === scaleKey) push(`column ${columnIndex + 1}`);
				});
				break;
			}
			case 'timeline': {
				const view = block as unknown as TimelineView;
				(view.milestones ?? []).forEach((milestone, milestoneIndex) => {
					if (milestone.status?.scaleRef === scaleKey) push(`milestone ${milestoneIndex + 1}`);
				});
				break;
			}
		}
	});
	return refs;
}

/**
 * Every block that references the entry `entryKey` of the scale `scaleKey` (the
 * delete guard's evidence for removing a single entry). Scoped to blocks that bind
 * `scaleKey`, mirroring the entry reference sites of `renameEntryKey`.
 */
export function findEntryReferences(
	doc: DocumentV1,
	scaleKey: string,
	entryKey: string
): ScaleReference[] {
	const refs: ScaleReference[] = [];
	forEachBlock(doc, (block, sectionIndex, blockIndex) => {
		const push = (via: string): void => {
			refs.push({ sectionIndex, blockIndex, blockType: block.type, via });
		};
		switch (block.type) {
			case 'chip-cluster': {
				const view = block as unknown as ChipClusterView;
				if (view.scaleRef === scaleKey && (view.entries ?? []).includes(entryKey)) push('entry');
				break;
			}
			case 'comparison-matrix': {
				const view = block as unknown as MatrixView;
				const findings = view.findings ?? [];
				if (view.severityScale === scaleKey) {
					findings.forEach((finding, findingIndex) => {
						if (finding.severity === entryKey) push(`finding ${findingIndex + 1} severity`);
					});
				}
				if (view.sourceScale === scaleKey) {
					findings.forEach((finding, findingIndex) => {
						if (
							finding.sources &&
							Object.prototype.hasOwnProperty.call(finding.sources, entryKey)
						) {
							push(`finding ${findingIndex + 1} source`);
						}
					});
				}
				break;
			}
			case 'table': {
				const view = block as unknown as TableView;
				const rows = view.rows ?? [];
				(view.columns ?? []).forEach((column) => {
					if (column.scaleRef !== scaleKey || typeof column.key !== 'string') return;
					const columnKey = column.key;
					rows.forEach((row, rowIndex) => {
						const cell = row[columnKey];
						if (cell !== undefined && cell !== null && cell !== '' && String(cell) === entryKey) {
							push(`row ${rowIndex + 1} column "${columnKey}"`);
						}
					});
				});
				break;
			}
			case 'timeline': {
				const view = block as unknown as TimelineView;
				(view.milestones ?? []).forEach((milestone, milestoneIndex) => {
					const status = milestone.status;
					if (status && status.scaleRef === scaleKey && status.entry === entryKey) {
						push(`milestone ${milestoneIndex + 1}`);
					}
				});
				break;
			}
		}
	});
	return refs;
}
