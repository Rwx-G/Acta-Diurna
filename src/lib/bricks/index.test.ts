import { describe, expect, it } from 'vitest';
import { sectionSchema, type DocumentV1Input, validateDocument } from '$lib/schema';
import { BRICKS, getBrick } from './index.ts';

describe('brick library', () => {
	it('every brick produces a schema-valid section', () => {
		for (const brick of BRICKS) {
			const result = sectionSchema.safeParse(brick.factory());
			expect(result.success, `${brick.id} section invalid`).toBe(true);
		}
	});

	it('every brick assembles into a valid single-section document', () => {
		for (const brick of BRICKS) {
			const document: DocumentV1Input = {
				version: 1,
				title: 'Skeleton',
				sections: [brick.factory()]
			};
			const result = validateDocument(document);
			expect(result.ok, `${brick.id} document invalid`).toBe(true);
		}
	});

	it('data-bound bricks declare binding fields without a dataSetId', () => {
		const dataBound = ['dataTable', 'chartSection', 'kpiRow'];
		for (const id of dataBound) {
			const section = getBrick(id)!.factory();
			const block = section.blocks[0] as { binding?: { dataSetId?: string; fields: unknown[] } };
			expect(block.binding, `${id} has no binding`).toBeDefined();
			expect(block.binding!.dataSetId).toBeUndefined();
			expect(block.binding!.fields.length).toBeGreaterThan(0);
		}
	});

	it('returns non-aliased binding objects across calls (mutation does not leak)', () => {
		const first = getBrick('dataTable')!.factory();
		const second = getBrick('dataTable')!.factory();
		const firstBlock = first.blocks[0] as { binding: { fields: { name: string }[] } };
		const secondBlock = second.blocks[0] as { binding: { fields: { name: string }[] } };

		expect(firstBlock.binding).not.toBe(secondBlock.binding);
		expect(firstBlock.binding.fields).not.toBe(secondBlock.binding.fields);

		firstBlock.binding.fields[0].name = 'mutated';
		firstBlock.binding.fields.push({ name: 'extra' });

		expect(secondBlock.binding.fields[0].name).toBe('item');
		expect(secondBlock.binding.fields).toHaveLength(3);
		// A third call still produces the pristine preset, proving the singleton survived.
		const third = getBrick('dataTable')!.factory();
		const thirdBlock = third.blocks[0] as { binding: { fields: { name: string }[] } };
		expect(thirdBlock.binding.fields[0].name).toBe('item');
	});

	it('the annex brick is annex-flagged', () => {
		const section = getBrick('annex')!.factory();
		expect(section.annex).toBe(true);
	});

	it('produces fresh unique ids on each call', () => {
		const first = getBrick('cover')!.factory();
		const second = getBrick('cover')!.factory();
		expect(first.id).not.toBe(second.id);
		expect(first.blocks[0].id).not.toBe(second.blocks[0].id);
	});

	it('all bricks assemble together into one valid document', () => {
		const document: DocumentV1Input = {
			version: 1,
			title: 'Full skeleton',
			sections: BRICKS.map((brick) => brick.factory())
		};
		const result = validateDocument(document);
		expect(result.ok).toBe(true);
	});

	it('getBrick returns undefined for an unknown id', () => {
		expect(getBrick('nope')).toBeUndefined();
	});
});
