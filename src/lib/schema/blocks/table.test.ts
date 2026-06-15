import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateDocument } from '../errors.ts';
import { tableBlockSchema, type TableBlock } from './table.ts';

function validBlock(overrides: Partial<TableBlock> = {}): TableBlock {
	return {
		type: 'table',
		id: 'requirements',
		columns: [
			{ key: 'name', label: 'Requirement' },
			{ key: 'state', label: 'Status', scaleRef: 'status' }
		],
		rows: [
			{ name: 'Login', state: 'done' },
			{ name: 'Audit log', state: 'in-progress' }
		],
		...overrides
	};
}

/** A document carrying a status scale and the given table block. */
function documentWithTable(block: unknown, withScales = true): unknown {
	return {
		version: 1,
		title: 'Requirements',
		...(withScales
			? {
					scales: [
						{
							key: 'status',
							label: 'Status',
							kind: 'nominal',
							entries: [
								{ key: 'done', label: 'Done' },
								{ key: 'in-progress', label: 'In progress' },
								{ key: 'blocked', label: 'Blocked' }
							]
						}
					]
				}
			: {}),
		sections: [{ id: 'overview', title: 'Overview', blocks: [block] }]
	};
}

describe('tableColumnSchema - scaleRef shape', () => {
	it('parses a column with an optional scaleRef', () => {
		const result = tableBlockSchema.safeParse(validBlock());
		expect(result.success).toBe(true);
		if (result.success) {
			expectTypeOf(result.data).toEqualTypeOf<TableBlock>();
			expect(result.data.columns[1].scaleRef).toBe('status');
			expect(result.data.columns[0].scaleRef).toBeUndefined();
		}
	});

	it('rejects a non-slug scaleRef', () => {
		const block = validBlock();
		block.columns[1].scaleRef = 'Not A Slug';
		expect(tableBlockSchema.safeParse(block).success).toBe(false);
	});

	it('assembles into a valid document when the column scale and cell values resolve', () => {
		expect(validateDocument(documentWithTable(validBlock())).ok).toBe(true);
	});
});

describe('table block - conditional-formatting cross reference (FR2)', () => {
	it('flags an unknown column scaleRef at the column path', () => {
		const block = validBlock();
		block.columns[1].scaleRef = 'ghost';
		const result = validateDocument(documentWithTable(block));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.path.endsWith('columns[1].scaleRef'));
			expect(issue?.path).toBe('sections[0].blocks[0].columns[1].scaleRef');
			expect(issue?.message).toContain('ghost');
		}
	});

	it('flags a cell value absent from the scale, naming the row and column', () => {
		const block = validBlock();
		block.rows = [
			{ name: 'Login', state: 'done' },
			{ name: 'Audit log', state: 'unknown-state' }
		];
		const result = validateDocument(documentWithTable(block));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.path.endsWith('rows[1].state'));
			expect(issue?.path).toBe('sections[0].blocks[0].rows[1].state');
			expect(issue?.message).toContain('unknown-state');
			// Names the column so the author can locate the bad cell.
			expect(issue?.message).toContain('Status');
		}
	});

	it('accepts an empty cell in a scaleRef column (blank, not a badge)', () => {
		const block = validBlock();
		block.rows = [
			{ name: 'Login', state: 'done' },
			{ name: 'Audit log', state: '' }
		];
		expect(validateDocument(documentWithTable(block)).ok).toBe(true);
	});

	it('flags a dangling column scaleRef when the document declares no scales', () => {
		const result = validateDocument(documentWithTable(validBlock(), false));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.some((e) => e.path.endsWith('columns[1].scaleRef'))).toBe(true);
		}
	});
});

describe('table block - duplicate column keys', () => {
	it('rejects two columns sharing a key, naming the colliding key', () => {
		const block = validBlock({
			columns: [
				{ key: 'name', label: 'Requirement' },
				{ key: 'name', label: 'Duplicate' }
			],
			rows: [{ name: 'Login' }]
		});
		const result = tableBlockSchema.safeParse(block);
		expect(result.success).toBe(false);
		if (!result.success) {
			const issue = result.error.issues.find((e) => e.path.join('.') === 'columns.1.key');
			expect(issue).toBeDefined();
			expect(issue?.message).toContain('name');
		}
	});

	it('surfaces the duplicate-key 422 through the document validator at the column path', () => {
		const block = validBlock({
			columns: [
				{ key: 'state', label: 'Status', scaleRef: 'status' },
				{ key: 'state', label: 'Status again' }
			],
			rows: [{ state: 'done' }]
		});
		const result = validateDocument(documentWithTable(block));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.path.endsWith('columns[1].key'));
			expect(issue?.path).toBe('sections[0].blocks[0].columns[1].key');
			expect(issue?.message).toContain('state');
		}
	});

	it('accepts distinct column keys', () => {
		const result = tableBlockSchema.safeParse(validBlock());
		expect(result.success).toBe(true);
	});
});

describe('table block - additivity', () => {
	it('validates a table with no scaleRef column unchanged', () => {
		const result = validateDocument(
			documentWithTable(
				{
					type: 'table',
					id: 'plain',
					columns: [
						{ key: 'name', label: 'Name' },
						{ key: 'count', label: 'Count' }
					],
					rows: [{ name: 'Alpha', count: 3 }]
				},
				false
			)
		);
		expect(result.ok).toBe(true);
	});

	it('does not require scales when no column declares a scaleRef', () => {
		const result = validateDocument({
			version: 1,
			title: 'Plain',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [
						{
							type: 'table',
							id: 'plain',
							columns: [{ key: 'name', label: 'Name' }],
							rows: [{ name: 'Alpha' }]
						}
					]
				}
			]
		});
		expect(result.ok).toBe(true);
	});
});
