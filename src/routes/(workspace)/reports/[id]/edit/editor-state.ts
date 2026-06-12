/**
 * Editor helpers specific to the 1.5 report block editor: block/section
 * factories, paragraph text flattening and the no-JS narrative-field
 * application. The cross-editor primitives (list reordering, error grouping,
 * path humanizing, the issue types) live in `$lib/editor` and are re-exported
 * here so this module's existing consumers keep one import. No DOM, no Drizzle.
 */
import type {
	Block,
	BlockType,
	DocumentV1,
	DocumentV1Input,
	Paragraph,
	Section
} from '$lib/schema';

export {
	groupErrorsByLocation,
	humanizePath,
	moveItem,
	type EditorIssue,
	type ErrorsByKey
} from '$lib/editor';

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
		case 'comparison-matrix':
			// Starts with empty scale refs and one empty finding: the author picks
			// the scales and fills the finding. Validation names the empties on save
			// (errors are guidance, the author is never blocked from adding a block).
			return {
				type,
				id,
				severityScale: '',
				sourceScale: '',
				findings: [
					{
						category: '',
						label: '',
						severity: '',
						sources: {},
						treatment: { before: '', after: '', status: 'action' }
					}
				]
			};
	}
}

/** A new section ships with one empty text block so it is one keystroke from valid. */
export function newSection(): Section {
	return { id: newId(), title: 'New section', blocks: [newBlock('text')] };
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
