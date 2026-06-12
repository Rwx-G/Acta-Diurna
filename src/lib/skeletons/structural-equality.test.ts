import { describe, expect, it } from 'vitest';
import { getBrick, BRICKS } from '$lib/bricks';
import { validateDocument, type DocumentV1 } from '$lib/schema';
import { fingerprintStructure, structurallyEqual } from './structural-equality.ts';

function documentFrom(title: string, ...brickIds: string[]): DocumentV1 {
	const result = validateDocument({
		version: 1 as const,
		title,
		sections: brickIds.map((id) => getBrick(id)!.factory())
	});
	if (!result.ok) throw new Error('test document must be valid');
	return result.document;
}

describe('structurallyEqual', () => {
	it('treats two fresh assemblies of the same bricks as structurally equal', () => {
		// Each brick factory regenerates ids and (for cover) authoring text, so these
		// two documents differ in ids and content yet share the same structure.
		const a = documentFrom('First', 'cover', 'dataTable', 'chartSection');
		const b = documentFrom('Second', 'cover', 'dataTable', 'chartSection');

		expect(structurallyEqual(a, b)).toBe(true);
	});

	it('ignores ids: a regenerated-id copy is still structurally equal', () => {
		const a = documentFrom('Original', 'kpiRow', 'summary');
		const b: DocumentV1 = JSON.parse(JSON.stringify(a));
		b.sections[0].id = 'totally-different-id';
		b.sections[0].blocks[0].id = 'another-id';

		expect(structurallyEqual(a, b)).toBe(true);
	});

	it('ignores content values: rewriting text and the title keeps equality', () => {
		const a = documentFrom('Original', 'cover');
		const b: DocumentV1 = JSON.parse(JSON.stringify(a));
		b.title = 'Renamed';
		const block = b.sections[0].blocks[0];
		if (block.type === 'text') block.paragraphs = [[{ text: 'Completely different prose.' }]];

		expect(structurallyEqual(a, b)).toBe(true);
	});

	it('differs when the block sequence differs', () => {
		const a = documentFrom('A', 'cover', 'dataTable');
		const b = documentFrom('B', 'cover', 'chartSection');

		expect(structurallyEqual(a, b)).toBe(false);
	});

	it('differs when section count differs', () => {
		const a = documentFrom('A', 'cover', 'dataTable');
		const b = documentFrom('B', 'cover');

		expect(structurallyEqual(a, b)).toBe(false);
	});

	it('differs when a binding field changes', () => {
		const a = documentFrom('A', 'dataTable');
		const b: DocumentV1 = JSON.parse(JSON.stringify(a));
		const block = b.sections[0].blocks[0];
		if (block.type === 'table' && block.binding) {
			block.binding.fields[0] = { name: 'renamed-field', type: 'string' };
		}

		expect(structurallyEqual(a, b)).toBe(false);
	});

	it('ignores binding.dataSetId: only the field shape is structural', () => {
		const a = documentFrom('A', 'chartSection');
		const b: DocumentV1 = JSON.parse(JSON.stringify(a));
		const block = b.sections[0].blocks[0];
		if (block.type === 'chart' && block.binding) {
			block.binding.dataSetId = 'some-dataset-id';
		}

		expect(structurallyEqual(a, b)).toBe(true);
	});

	it('the full library assembled twice fingerprints identically', () => {
		const a = documentFrom('Everything A', ...BRICKS.map((brick) => brick.id));
		const b = documentFrom('Everything B', ...BRICKS.map((brick) => brick.id));

		expect(fingerprintStructure(a)).toEqual(fingerprintStructure(b));
	});
});
