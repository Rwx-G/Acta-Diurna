import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Block, DocumentV1 } from '$lib/schema';
import type { BlockDiagnostic } from '$lib/server/ingestion';
import BlockEditor from './BlockEditor.svelte';
import type { DiagnosticContext } from './editor-types';

function renderBlock(block: Block, issues: { path: string; message: string; hint?: string }[]) {
	// BlockEditor declares block = $bindable(); a $state source keeps the bind:
	// target reactive (silences binding_property_non_reactive in the test).
	const reactiveBlock = $state(block);
	return render(BlockEditor, {
		block: reactiveBlock,
		blockIndex: 0,
		count: 1,
		issues,
		onEdit: vi.fn(),
		onRemove: vi.fn(),
		onMove: vi.fn()
	});
}

function renderBindableBlock(
	block: Block,
	options: {
		diagnostic?: BlockDiagnostic;
		diagnosticFields?: string[];
		diagnosticDataSetId?: string | null;
		onRemapped?: (savedAt: string, document: DocumentV1, blockId: string) => void;
	} = {}
) {
	const reactiveBlock = $state(block);
	const diagnosticContext: DiagnosticContext = {
		byBlock: options.diagnostic
			? new Map([[options.diagnostic.blockId, options.diagnostic]])
			: new Map(),
		fields: options.diagnosticFields ?? [],
		dataSetId: options.diagnosticDataSetId ?? null
	};
	return render(BlockEditor, {
		block: reactiveBlock,
		blockIndex: 0,
		count: 1,
		issues: [],
		diagnostic: options.diagnostic,
		diagnosticContext,
		onRemapped: options.onRemapped,
		onEdit: vi.fn(),
		onRemove: vi.fn(),
		onMove: vi.fn()
	});
}

describe('BlockEditor inline validation', () => {
	it('renders each issue at the block with message, hint and field path', async () => {
		const { getByRole, getByText } = renderBlock(
			{ type: 'image', id: 'figure', assetId: '', alt: '' },
			[
				{
					path: 'sections[0].blocks[0].alt',
					message: 'Alt text must not be empty.',
					hint: 'Describe the image for screen readers; alt text is required on every image block.'
				}
			]
		);

		await expect.element(getByRole('alert')).toBeVisible();
		await expect.element(getByText('Alt text must not be empty.')).toBeVisible();
		await expect
			.element(getByText('Describe the image for screen readers', { exact: false }))
			.toBeVisible();
		// The raw indexed path is humanised to a readable field label (no brackets,
		// no indices) so the author sees `alt`, not `sections[0].blocks[0].alt`.
		await expect.element(getByText('alt', { exact: true })).toBeVisible();
	});

	it('renders no alert when the block has no issues', async () => {
		const { getByRole, getByLabelText } = renderBlock(
			{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Fine.' }]] },
			[]
		);

		await expect.element(getByLabelText('Paragraph 1, run 1 text', { exact: true })).toBeVisible();
		expect(getByRole('alert').query()).toBeNull();
	});
});

describe('BlockEditor binding state (Epic 10.5)', () => {
	it('shows "Bound to data set" for a bindable block whose binding resolves a data set', async () => {
		// A bound block's values come from the data set: its binding carries a resolved
		// `dataSetId` (and a `dataAsOf` freshness instant). The editor surfaces the bound
		// state clearly so the author knows the values are data-driven, not static.
		const { getByText } = renderBindableBlock({
			type: 'table',
			id: 'metrics',
			columns: [{ key: 'severity', label: 'Severity' }],
			binding: {
				dataSetId: '01970000-0000-7000-8000-0000000000bb',
				dataAsOf: '2026-06-12T00:00:00Z',
				fields: [{ name: 'severity', type: 'string', slot: { role: 'column' } }]
			}
		});

		await expect.element(getByText('Bound to data set')).toBeVisible();
		await expect.element(getByText('Data as of 2026-06-12')).toBeVisible();
	});

	it('shows "Static data" for a bindable block with no resolved binding', async () => {
		// A table carrying only static rows (edited in 10.3/10.4), no data-set binding:
		// the editor labels it static so the bound-vs-static state is never ambiguous.
		const { getByText } = renderBindableBlock({
			type: 'table',
			id: 'metrics',
			columns: [{ key: 'severity', label: 'Severity' }],
			rows: [{ severity: 'Critical' }]
		});

		await expect.element(getByText('Static data')).toBeVisible();
		expect(getByText('Bound to data set').query()).toBeNull();
	});

	it('does not show a binding state row for a non-bindable block', async () => {
		const { getByLabelText } = renderBlock(
			{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Plain.' }]] },
			[]
		);

		expect(getByLabelText('Binding state').query()).toBeNull();
	});

	it('surfaces a drift diagnostic chip at the block and opens the inline remap', async () => {
		// FR15 at the editor surface: a drifted field surfaces as an amber chip AT the
		// block; opening it reveals the diagnostic naming the expected field and its
		// closest match, with the inline remap reaching the existing `?/remap` action.
		const diagnostic: BlockDiagnostic = {
			blockId: 'metrics',
			blockType: 'table',
			label: 'Metrics - table',
			state: 'drifted',
			drifts: [{ expected: 'count', closest: 'counts', distance: 1 }]
		};
		const { getByRole, getByText, container } = renderBindableBlock(
			{
				type: 'table',
				id: 'metrics',
				columns: [{ key: 'severity', label: 'Severity' }],
				binding: {
					dataSetId: '01970000-0000-7000-8000-0000000000bb',
					fields: [{ name: 'count', type: 'number', slot: { role: 'column' } }]
				}
			},
			{
				diagnostic,
				diagnosticFields: ['severity', 'counts'],
				diagnosticDataSetId: '01970000-0000-7000-8000-0000000000bb'
			}
		);

		// The chip names the drift count and is collapsed (no diagnostic panel yet).
		const chip = getByRole('button', { name: /Drifted/ });
		await expect.element(chip).toBeVisible();
		expect(getByText('closest match').query()).toBeNull();

		await chip.click();

		// The diagnostic names the expected field and highlights its closest match; the
		// inline remap form posts to the `?/remap` action with the block + data set ids.
		await expect.element(getByText('closest match')).toBeVisible();
		await expect.element(getByText('count', { exact: true })).toBeVisible();
		const remapForm = container.querySelector('form[action="?/remap"]');
		expect(remapForm).not.toBeNull();
		expect(remapForm?.querySelector('input[name="blockId"]')?.getAttribute('value')).toBe(
			'metrics'
		);
		expect(remapForm?.querySelector('input[name="expectedField"]')?.getAttribute('value')).toBe(
			'count'
		);
	});

	it('shows no diagnostic chip when the block is clean (no drift)', async () => {
		const { getByRole } = renderBindableBlock({
			type: 'table',
			id: 'metrics',
			columns: [{ key: 'severity', label: 'Severity' }],
			binding: {
				dataSetId: '01970000-0000-7000-8000-0000000000bb',
				fields: [{ name: 'severity', type: 'string', slot: { role: 'column' } }]
			}
		});

		expect(getByRole('button', { name: /Drifted/ }).query()).toBeNull();
	});
});
