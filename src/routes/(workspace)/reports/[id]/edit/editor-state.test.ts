import { describe, expect, it } from 'vitest';
import { validateDocument, type BlockType, type DocumentV1Input } from '$lib/schema';
import {
	applyNarrativeFields,
	groupErrorsByLocation,
	humanizePath,
	moveItem,
	newBlock,
	newSection,
	optimisticDocumentIssues,
	paragraphText
} from './editor-state';

function documentWith(blocks: DocumentV1Input['sections'][number]['blocks']): DocumentV1Input {
	return {
		version: 1,
		title: 'Editor State Fixture',
		sections: [{ id: 'fixture', title: 'Fixture', blocks }]
	};
}

describe('newBlock', () => {
	it.each(['text', 'table', 'chart'] as BlockType[])(
		'creates a schema-valid starter %s block',
		(type) => {
			const result = validateDocument(documentWith([newBlock(type)]));

			expect(result.ok).toBe(true);
		}
	);

	it('creates kpi and image starters whose validation errors name the empty fields', () => {
		const kpi = validateDocument(documentWith([newBlock('kpi')]));
		expect(kpi.ok).toBe(false);
		if (!kpi.ok) {
			expect(kpi.errors.map((error) => error.path)).toContain(
				'sections[0].blocks[0].items[0].label'
			);
		}

		const image = validateDocument(documentWith([newBlock('image')]));
		expect(image.ok).toBe(false);
		if (!image.ok) {
			const paths = image.errors.map((error) => error.path);
			expect(paths).toContain('sections[0].blocks[0].assetId');
			expect(paths).toContain('sections[0].blocks[0].alt');
		}
	});

	it('creates a comparison-matrix starter whose validation names the empty scale refs', () => {
		const block = newBlock('comparison-matrix');
		expect(block.type).toBe('comparison-matrix');
		// The starter carries empty scale refs (not slug-valid), so its own block
		// schema flags them; the author picks the scales before saving.
		const result = validateDocument(documentWith([block]));
		expect(result.ok).toBe(false);
	});

	it('creates a field-grid starter whose validation names the empty item fields', () => {
		const block = newBlock('field-grid');
		expect(block.type).toBe('field-grid');
		const result = validateDocument(documentWith([block]));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.map((error) => error.path)).toContain(
				'sections[0].blocks[0].items[0].label'
			);
		}
	});

	it('creates a legend starter whose validation names the empty scale ref', () => {
		const block = newBlock('legend');
		expect(block.type).toBe('legend');
		// The starter carries an empty scaleRef (not slug-valid), so its block schema
		// flags it; the author picks the scale before saving.
		const result = validateDocument(documentWith([block]));
		expect(result.ok).toBe(false);
	});

	it('creates a set-membership starter whose validation names the empty source ref', () => {
		const block = newBlock('set-membership');
		expect(block.type).toBe('set-membership');
		// The starter carries an empty sourceBlockId (not slug-valid), so its block
		// schema flags it; the author picks the comparison matrix before saving.
		const result = validateDocument(documentWith([block]));
		expect(result.ok).toBe(false);
	});

	it('creates a schema-valid callout starter (a default tone and an empty body)', () => {
		const block = newBlock('callout');
		expect(block.type).toBe('callout');
		if (block.type === 'callout') expect(block.tone).toBe('info');
		// Like the text block, the callout starts valid: a tone and one empty body
		// paragraph, no scale or icon needed.
		expect(validateDocument(documentWith([block])).ok).toBe(true);
	});

	it('creates a schema-valid code starter (an empty code string)', () => {
		const block = newBlock('code');
		expect(block.type).toBe('code');
		if (block.type === 'code') expect(block.code).toBe('');
		// The code block starts valid: an empty source, no language or annotations
		// needed to render.
		expect(validateDocument(documentWith([block])).ok).toBe(true);
	});

	it('creates a card-grid starter (two columns) whose validation names the empty card fields', () => {
		const block = newBlock('card-grid');
		expect(block.type).toBe('card-grid');
		if (block.type === 'card-grid') expect(block.columns).toBe(2);
		const result = validateDocument(documentWith([block]));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.map((error) => error.path)).toContain(
				'sections[0].blocks[0].items[0].title'
			);
		}
	});

	it('creates an ordered list starter whose validation names the empty item term', () => {
		const block = newBlock('list');
		expect(block.type).toBe('list');
		if (block.type === 'list') expect(block.ordered).toBe(true);
		const result = validateDocument(documentWith([block]));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.map((error) => error.path)).toContain(
				'sections[0].blocks[0].items[0].term'
			);
		}
	});

	it('creates a timeline starter whose validation names the empty milestone label', () => {
		const block = newBlock('timeline');
		expect(block.type).toBe('timeline');
		if (block.type === 'timeline') expect(block.milestones).toHaveLength(1);
		const result = validateDocument(documentWith([block]));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.map((error) => error.path)).toContain(
				'sections[0].blocks[0].milestones[0].label'
			);
		}
	});

	it('assigns a fresh slug-valid id per block', () => {
		const first = newBlock('text');
		const second = newBlock('text');

		expect(first.id).not.toBe(second.id);
		expect(first.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
	});
});

describe('newSection', () => {
	it('creates a schema-valid section with one empty text block', () => {
		const section = newSection();

		const result = validateDocument({
			version: 1,
			title: 'Section Fixture',
			sections: [section]
		});

		expect(result.ok).toBe(true);
		expect(section.blocks).toHaveLength(1);
		expect(section.blocks[0].type).toBe('text');
	});
});

describe('moveItem', () => {
	it('swaps an item with its neighbor', () => {
		const items = ['a', 'b', 'c'];

		moveItem(items, 0, 1);
		expect(items).toEqual(['b', 'a', 'c']);

		moveItem(items, 2, -1);
		expect(items).toEqual(['b', 'c', 'a']);
	});

	it('ignores moves past either end', () => {
		const items = ['a', 'b'];

		moveItem(items, 0, -1);
		moveItem(items, 1, 1);

		expect(items).toEqual(['a', 'b']);
	});
});

describe('paragraphText', () => {
	it('concatenates run text, dropping formatting', () => {
		expect(paragraphText([{ text: 'One ' }, { text: 'two', bold: true }])).toBe('One two');
		expect(paragraphText([])).toBe('');
	});
});

describe('humanizePath', () => {
	it('reduces an indexed path to its readable trailing field', () => {
		expect(humanizePath('sections[0].blocks[2].items[1].label')).toBe('label');
		expect(humanizePath('sections[0].title')).toBe('title');
		expect(humanizePath('title')).toBe('title');
	});

	it('splits camelCase fields into words', () => {
		expect(humanizePath('sections[0].blocks[0].assetId')).toBe('asset id');
		expect(humanizePath('sections[0].blocks[0].stickyHeader')).toBe('sticky header');
	});
});

describe('groupErrorsByLocation', () => {
	const document = {
		sections: [
			{ id: 'alpha', blocks: [{ id: 'alpha-1' }, { id: 'alpha-2' }] },
			{ id: 'beta', blocks: [{ id: 'beta-1' }] }
		]
	};

	it('maps block, section and document paths to stable ids', () => {
		const grouped = groupErrorsByLocation(
			[
				{ path: 'sections[0].blocks[1].alt', message: 'Alt text must not be empty.' },
				{ path: 'sections[1].title', message: 'A section needs a title.' },
				{ path: 'title', message: 'A document needs a title.' },
				{ path: 'sections', message: 'A document must contain at least one section.' }
			],
			document
		);

		expect(grouped['block:alpha-2']).toHaveLength(1);
		expect(grouped['section:beta']).toHaveLength(1);
		expect(grouped['document']).toHaveLength(2);
	});

	it('falls back to the document group when indices point nowhere', () => {
		const grouped = groupErrorsByLocation(
			[{ path: 'sections[9].blocks[9].id', message: 'gone' }],
			document
		);

		expect(grouped['document']).toHaveLength(1);
	});

	it('keeps an error on the right block when sections reorder between submit and render', () => {
		// The error path is index-based against the SUBMITTED document. The page
		// maps it against that snapshot, not the live (reordered) doc, so the
		// stable block id stays correct even after the author swaps sections.
		const submitted = {
			sections: [
				{ id: 'alpha', blocks: [{ id: 'alpha-1' }] },
				{ id: 'beta', blocks: [{ id: 'beta-1' }] }
			]
		};
		const grouped = groupErrorsByLocation(
			[{ path: 'sections[1].blocks[0].alt', message: 'Alt text must not be empty.' }],
			submitted
		);

		// The error names the second section's block at submit time: beta-1.
		expect(grouped['block:beta-1']).toHaveLength(1);
		// Re-grouping against a reordered live doc would still resolve by id, never
		// by stale index, so the alert never jumps to the wrong block.
		expect(grouped['block:alpha-1']).toBeUndefined();
	});
});

describe('applyNarrativeFields', () => {
	function baseDocument() {
		const result = validateDocument({
			version: 1,
			title: 'Original',
			sections: [
				{
					id: 'one',
					title: 'Section One',
					blocks: [
						{
							type: 'text',
							id: 'narrative',
							paragraphs: [
								[{ text: 'First ' }, { text: 'paragraph', bold: true }],
								[{ text: 'Second paragraph' }]
							]
						},
						{
							type: 'kpi',
							id: 'numbers',
							items: [{ label: 'Uptime', value: '99.9' }]
						}
					]
				}
			]
		});
		if (!result.ok) throw new Error('fixture must be valid');
		return result.document;
	}

	it('applies title, section titles and paragraphs, flattening edited runs only', () => {
		const data = new FormData();
		data.set('title', 'Updated');
		data.set('section-title:0', 'Renamed');
		data.set('paragraph:0:0:0', 'Rewritten first');

		const next = applyNarrativeFields(baseDocument(), data);

		expect(next.title).toBe('Updated');
		expect(next.sections[0].title).toBe('Renamed');
		const block = next.sections[0].blocks[0];
		if (block.type !== 'text') throw new Error('expected text block');
		expect(block.paragraphs[0]).toEqual([{ text: 'Rewritten first' }]);
		// The untouched paragraph keeps its runs verbatim.
		expect(block.paragraphs[1]).toEqual([{ text: 'Second paragraph' }]);
	});

	it('ignores unknown names and out-of-range or non-text targets', () => {
		const data = new FormData();
		data.set('paragraph:0:1:0', 'not a text block');
		data.set('paragraph:0:0:9', 'no such paragraph');
		data.set('section-title:5', 'no such section');
		data.set('unrelated', 'ignored');

		const original = baseDocument();
		const next = applyNarrativeFields(original, data);

		expect(next).toEqual(original);
	});

	it('does not mutate the input document', () => {
		const original = baseDocument();
		const data = new FormData();
		data.set('title', 'Changed');

		applyNarrativeFields(original, data);

		expect(original.title).toBe('Original');
	});
});

describe('optimisticDocumentIssues', () => {
	it('returns no issues for a valid document', () => {
		expect(optimisticDocumentIssues(documentWith([newBlock('text')]))).toEqual([]);
	});

	it('places an issue at the failing block with the same path shape the server emits', () => {
		// The optimistic client validation must agree with `validateDocument` on the
		// error PATH so `groupErrorsByLocation` maps both to the same block. An image
		// block with empty alt is a stable, single-field failure to compare on.
		const document = documentWith([newBlock('image')]);

		const optimistic = optimisticDocumentIssues(document);
		const server = validateDocument(document);

		expect(server.ok).toBe(false);
		const optimisticPaths = optimistic.map((issue) => issue.path);
		expect(optimisticPaths).toContain('sections[0].blocks[0].alt');
		if (!server.ok) {
			// Every server error path is reproduced by the optimistic pass (it runs the
			// SAME `documentSchemaV1`, including the cross-reference passes), so the
			// inline placement is identical before and after the round-trip.
			for (const serverPath of server.errors.map((error) => error.path)) {
				expect(optimisticPaths).toContain(serverPath);
			}
		}
	});

	it('groups its issues onto the failing block id like the server errors do', () => {
		const document = documentWith([newBlock('image')]);
		const issues = optimisticDocumentIssues(document);

		const grouped = groupErrorsByLocation(issues, document);

		expect(grouped['block:' + document.sections[0].blocks[0].id]).toBeDefined();
	});

	it('reports a root-level failure under the document group', () => {
		// An empty title is a root field: its path is `title`, which groups to
		// `document` (not a block), so the editor surfaces it at the document level.
		const issues = optimisticDocumentIssues({
			version: 1,
			title: '',
			sections: [{ id: 'fixture', title: 'Fixture', blocks: [newBlock('text')] }]
		});

		expect(issues.map((issue) => issue.path)).toContain('title');
		expect(
			groupErrorsByLocation(issues, documentWith([newBlock('text')]))['document']
		).toBeDefined();
	});
});
