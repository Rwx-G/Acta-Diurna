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

/**
 * A comparison-matrix block offered to the set-membership block editor's source
 * picker (story 7.4): the block id a set-membership block references, with a
 * human label (section title + id) for the option text.
 */
export interface MatrixBlockOption {
	id: string;
	label: string;
}

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
		case 'field-grid':
			// Starts with one empty item: validation names the empty label/value on
			// save (errors are guidance, the author is never blocked from adding a
			// block).
			return { type, id, items: [{ label: '', value: '' }] };
		case 'legend':
			// Starts with an empty scale ref (not slug-valid): its block schema flags
			// it; the author picks the scale before saving.
			return { type, id, scaleRef: '' };
		case 'set-membership':
			// Starts with an empty source-block ref (not slug-valid): the document
			// cross-reference pass flags it; the author picks the comparison-matrix
			// block before saving.
			return { type, id, sourceBlockId: '' };
		case 'chip-cluster':
			// Starts with an empty scale ref (not slug-valid) and one empty entry: its
			// block schema flags the empties; the author picks the scale and entries
			// before saving.
			return { type, id, scaleRef: '', entries: [''] };
		case 'callout':
			// Starts schema-valid: a default tone and one empty body paragraph (like
			// the text block). The tone is a closed enum, so the starter picks `info`;
			// no scale or icon is needed to render.
			return { type, id, tone: 'info', body: [[{ text: '' }]] };
		case 'code':
			// Starts schema-valid: an empty code string (no language, no annotations).
			// The author types the snippet; nothing is required to render.
			return { type, id, code: '' };
		case 'card-grid':
			// Starts with two columns and one empty card (no icon): validation names
			// the empty title/description on save (errors are guidance, the author is
			// never blocked from adding a block).
			return { type, id, columns: 2, items: [{ title: '', description: '' }] };
		case 'list':
			// Starts ordered (a numbered procedure) with one item carrying an empty
			// term: validation names the empty term on save (errors are guidance, the
			// author is never blocked from adding a block).
			return { type, id, ordered: true, items: [{ term: '' }] };
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
