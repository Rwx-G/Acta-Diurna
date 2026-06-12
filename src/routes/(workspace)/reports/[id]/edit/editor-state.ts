/**
 * Pure editor helpers shared by the editor page (client) and its save action
 * (server): block factories, list reordering, error-to-block mapping and the
 * no-JS narrative-field application. No DOM, no Drizzle.
 */
import type {
	Block,
	BlockType,
	DocumentV1,
	DocumentV1Input,
	Paragraph,
	Section,
	ValidationErrorDetail
} from '$lib/schema';

export type EditorIssue = ValidationErrorDetail;

/** Issues grouped by editor location: `document`, `section:<id>` or `block:<id>`. */
export type ErrorsByKey = Record<string, EditorIssue[]>;

// Editor-generated section/block ids only need to satisfy the schema's slug
// rule (lowercase alphanumerics and hyphens) - they are document-internal
// anchors, not database keys. The UUIDv7 rule applies only to the report row id,
// which the server assigns on create; a crypto.randomUUID() here is a
// convenient slug-valid unique value and is never persisted as a row primary
// key. crypto.randomUUID() exists in both the browser and Node 22.
function newId(): string {
	return crypto.randomUUID();
}

/**
 * Starter shape per block type. Text, table and chart start schema-valid;
 * kpi and image start with the empty fields validation will name on save
 * (errors are guidance, the author is never blocked from adding a block).
 */
export function newBlock(type: BlockType): Block {
	const id = newId();
	switch (type) {
		case 'text':
			return { type, id, paragraphs: [[{ text: '' }]] };
		case 'table':
			return { type, id, columns: [{ key: 'column-1', label: 'Column 1' }], rows: [{}] };
		case 'chart':
			return { type, id, kind: 'line', series: [{ name: 'Series 1', points: [] }] };
		case 'kpi':
			return { type, id, items: [{ label: '', value: '' }] };
		case 'image':
			return { type, id, assetId: '', alt: '' };
	}
}

/** A new section ships with one empty text block so it is one keystroke from valid. */
export function newSection(): Section {
	return { id: newId(), title: 'New section', blocks: [newBlock('text')] };
}

/** Swaps an item with its neighbor in place; out-of-bounds moves are no-ops. */
export function moveItem<T>(items: T[], index: number, direction: -1 | 1): void {
	const target = index + direction;
	if (index < 0 || index >= items.length || target < 0 || target >= items.length) return;
	const [moved] = items.splice(index, 1);
	items.splice(target, 0, moved);
}

/**
 * The MVP editor edits paragraphs as plain text: the displayed value is the
 * concatenated run text, and an edit replaces the paragraph with a single
 * unformatted run. Editor-created documents only ever contain plain runs;
 * formatting on agent-authored paragraphs is flattened only when that
 * paragraph is edited (accepted MVP trade-off, WYSIWYG arrives in v2).
 */
export function paragraphText(paragraph: Paragraph): string {
	return paragraph.map((run) => run.text).join('');
}

/**
 * Turns a validation error path into a readable field label for the author:
 * the last non-index segment with separators normalised. `sections[0].blocks[2]
 * .items[1].label` becomes `label`, `sections[0].title` becomes `title`. The
 * raw indexed path is noise to a human; the inline placement already says which
 * block the error belongs to.
 */
export function humanizePath(path: string): string {
	const segments = path
		.replace(/\[\d+\]/g, '')
		.split('.')
		.filter((segment) => segment.length > 0);
	const last = segments.at(-1) ?? path;
	return last.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

const LOCATION_PATTERN = /^sections\[(\d+)\](?:\.blocks\[(\d+)\])?/;

interface DocumentShape {
	sections: { id: string; blocks: { id: string }[] }[];
}

/**
 * Maps validation error paths (index-based, from the submitted document) to
 * stable section/block ids so each error renders inline at the failing block
 * even if the author reorders things before fixing. Paths that name no
 * existing section or block fall back to the `document` group.
 */
export function groupErrorsByLocation(
	errors: readonly EditorIssue[],
	document: DocumentShape
): ErrorsByKey {
	const grouped: ErrorsByKey = {};
	for (const issue of errors) {
		const match = LOCATION_PATTERN.exec(issue.path);
		const section = match ? document.sections[Number(match[1])] : undefined;
		const block = match?.[2] !== undefined ? section?.blocks[Number(match[2])] : undefined;
		const key = block ? `block:${block.id}` : section ? `section:${section.id}` : 'document';
		(grouped[key] ??= []).push(issue);
	}
	return grouped;
}

/**
 * No-JS baseline of the save action: applies the posted narrative fields
 * (report title, section titles, text paragraphs) onto the stored document.
 * Structural edits and data blocks need JavaScript (accepted MVP gap,
 * documented in the story). Unknown field names are ignored.
 */
export function applyNarrativeFields(document: DocumentV1, data: FormData): DocumentV1Input {
	const next = structuredClone(document) as DocumentV1Input;
	for (const [name, value] of data.entries()) {
		if (typeof value !== 'string') continue;
		if (name === 'title') {
			next.title = value;
			continue;
		}
		const sectionTitle = /^section-title:(\d+)$/.exec(name);
		if (sectionTitle) {
			const section = next.sections[Number(sectionTitle[1])];
			if (section) section.title = value;
			continue;
		}
		const paragraph = /^paragraph:(\d+):(\d+):(\d+)$/.exec(name);
		if (paragraph) {
			const block = next.sections[Number(paragraph[1])]?.blocks[Number(paragraph[2])];
			const paragraphIndex = Number(paragraph[3]);
			if (block?.type === 'text' && paragraphIndex < block.paragraphs.length) {
				block.paragraphs[paragraphIndex] = [{ text: value }];
			}
		}
	}
	return next;
}
