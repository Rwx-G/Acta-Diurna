import { describe, expect, it } from 'vitest';
import { sectionSchema, type DocumentV1Input, type Scales, validateDocument } from '$lib/schema';
import { BRICKS, getBrick, type Brick } from './index.ts';

/** Merges a brick's companion scales (Epic 7) so an assembled document resolves
 *  its scale references; a scale-free brick contributes none. */
function scalesFor(bricks: readonly Brick[]): Scales {
	return bricks.flatMap((brick) => brick.scales?.() ?? []);
}

describe('brick library', () => {
	it('every brick produces a schema-valid section', () => {
		for (const brick of BRICKS) {
			const result = sectionSchema.safeParse(brick.factory());
			expect(result.success, `${brick.id} section invalid`).toBe(true);
		}
	});

	it('every brick assembles into a valid single-section document', () => {
		for (const brick of BRICKS) {
			const scales = scalesFor([brick]);
			const document: DocumentV1Input = {
				version: 1,
				title: 'Skeleton',
				...(scales.length > 0 ? { scales } : {}),
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
			scales: scalesFor(BRICKS),
			sections: BRICKS.map((brick) => brick.factory())
		};
		const result = validateDocument(document);
		expect(result.ok).toBe(true);
	});

	it('the comparison-matrix brick seeds the scales its block references', () => {
		const brick = getBrick('comparisonMatrix')!;
		expect(brick.scales).toBeDefined();
		const document: DocumentV1Input = {
			version: 1,
			title: 'Matrix skeleton',
			scales: brick.scales!(),
			sections: [brick.factory()]
		};
		expect(validateDocument(document).ok).toBe(true);

		// Without the companion scales, the document-level cross-reference pass
		// flags the dangling severity/source references (FR2).
		const danglingResult = validateDocument({
			version: 1,
			title: 'Matrix skeleton',
			sections: [brick.factory()]
		});
		expect(danglingResult.ok).toBe(false);
	});

	it('the field-grid brick yields a validating scale-free section', () => {
		const brick = getBrick('fieldGrid')!;
		expect(brick.scales).toBeUndefined();
		const document: DocumentV1Input = {
			version: 1,
			title: 'Field grid skeleton',
			sections: [brick.factory()]
		};
		expect(validateDocument(document).ok).toBe(true);
	});

	it('the legend brick seeds the scale its block references', () => {
		const brick = getBrick('legend')!;
		expect(brick.scales).toBeDefined();
		const document: DocumentV1Input = {
			version: 1,
			title: 'Legend skeleton',
			scales: brick.scales!(),
			sections: [brick.factory()]
		};
		expect(validateDocument(document).ok).toBe(true);

		// Without the companion scale, the cross-reference pass flags the dangling
		// legend scaleRef (FR2).
		const dangling = validateDocument({
			version: 1,
			title: 'Legend skeleton',
			sections: [brick.factory()]
		});
		expect(dangling.ok).toBe(false);
	});

	it('getBrick returns undefined for an unknown id', () => {
		expect(getBrick('nope')).toBeUndefined();
	});
});
