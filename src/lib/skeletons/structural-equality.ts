/**
 * Structural equality for documents (FR11). Two documents are structurally equal
 * when their section/block shape and binding expectations match, ignoring ids and
 * content values - the exact guarantee a skeleton makes about the reports it
 * instantiates: every issue of a recurring report has an identical structure.
 *
 * Isomorphic: schema types only, no `$lib/server` or `$lib/ui`, so the FR11 test,
 * the service, and any future client check share one definition of "same shape".
 *
 * What counts as structure (compared):
 * - section order, each section's `annex` flag and audience set, block count;
 * - block order, `type`, and audience set (audience-gated visibility is structure);
 * - data-bound block `binding.fields` (each field's name + type), order-insensitive.
 *
 * What is ignored (content, not structure): every id, the document/section title,
 * text paragraphs, table rows, chart series, kpi items, image asset/alt, chart
 * kind/axis labels, `binding.dataSetId` (data arrives at instantiation/refill).
 */
import type { Binding, Block, DocumentV1, Section } from '$lib/schema';

/** A content-free fingerprint of a document's structure. Equal fingerprints (deep) mean structurally identical. */
export interface StructureFingerprint {
	sections: SectionFingerprint[];
}

interface SectionFingerprint {
	annex: boolean;
	audiences: string[];
	blocks: BlockFingerprint[];
}

interface BlockFingerprint {
	type: Block['type'];
	audiences: string[];
	binding: BindingFingerprint | null;
}

/** Field name+type pairs, sorted, so binding equality is order-insensitive. */
type BindingFingerprint = string[];

function fingerprintBinding(binding: Binding | undefined): BindingFingerprint | null {
	if (!binding) return null;
	return binding.fields.map((field) => `${field.name}:${field.type}`).sort();
}

function blockBinding(block: Block): Binding | undefined {
	// Only table/chart/kpi carry a binding; text/image never do.
	if (block.type === 'table' || block.type === 'chart' || block.type === 'kpi') {
		return block.binding;
	}
	return undefined;
}

function fingerprintBlock(block: Block): BlockFingerprint {
	return {
		type: block.type,
		audiences: [...(block.audiences ?? [])].sort(),
		binding: fingerprintBinding(blockBinding(block))
	};
}

function fingerprintSection(section: Section): SectionFingerprint {
	return {
		annex: section.annex ?? false,
		audiences: [...(section.audiences ?? [])].sort(),
		blocks: section.blocks.map(fingerprintBlock)
	};
}

/** Reduces a document to its structural fingerprint (ids and content stripped). */
export function fingerprintStructure(document: DocumentV1): StructureFingerprint {
	return { sections: document.sections.map(fingerprintSection) };
}

/**
 * True when two documents share the same structure (sections/blocks/bindings),
 * ignoring ids and content values. The FR11 contract: two reports instantiated
 * from one skeleton are structurally equal.
 */
export function structurallyEqual(a: DocumentV1, b: DocumentV1): boolean {
	return JSON.stringify(fingerprintStructure(a)) === JSON.stringify(fingerprintStructure(b));
}
