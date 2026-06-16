import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ActionResult } from '@sveltejs/kit';
import { validateDocument, type DocumentV1, type DocumentV1Input } from '$lib/schema';
import type { BlockDiagnostic } from '$lib/server/ingestion';

// Story 10.5: data binding from the WYSIWYG editor. These tests cover the two
// editor-side guarantees the binding actions inherit:
//  1. BlockBinder / RefillPanel report a successful bind / rebind / remap UP to the
//     editor (the re-resolved document + its new `updatedAt`), instead of the old
//     invalidateAll - the seam the editor uses to reconcile its concurrency token.
//  2. ReportEditor reconciles that token: a binding action advances the editor's
//     `expectedUpdatedAt` (the value the NEXT document save asserts), so a save after
//     a bind does not spuriously 409 - exactly the publish/unpublish reconciliation,
//     plus the document reseed (a bind mutates the document, not just the timestamp).
//
// The form POSTs go through `use:enhance`. There is no server in the component
// runner, so `$app/forms` is mocked: the mock captures each form's SubmitFunction
// and lets a test drive its result callback with a synthetic ActionResult, the
// same shape SvelteKit hands the callback after a real round-trip. This exercises
// the editor's reconciliation logic without a live action.

// Per-form submit drivers, keyed by the form's `action` attribute. Each entry runs
// the component's SubmitFunction (so its formData mutations + state flips happen)
// then invokes the returned result callback with the test's ActionResult.
const submitDrivers = new Map<string, (result: ActionResult) => Promise<void>>();

vi.mock('$app/forms', () => ({
	enhance: (form: HTMLFormElement, submit: (input: unknown) => unknown) => {
		const handler = async (event: Event) => {
			event.preventDefault();
			const formData = new FormData(form);
			const callback = submit({
				action: new URL(form.action),
				formData,
				formElement: form,
				controller: new AbortController(),
				submitter: null,
				cancel: () => {}
			}) as ((opts: { result: ActionResult; formData: FormData }) => Promise<void>) | undefined;
			const actionPath = form.getAttribute('action') ?? '';
			submitDrivers.set(actionPath, async (result: ActionResult) => {
				if (callback) await callback({ result, formData });
			});
		};
		form.addEventListener('submit', handler);
		return { destroy: () => form.removeEventListener('submit', handler) };
	}
}));

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }));

async function drive(actionPath: string, result: ActionResult): Promise<void> {
	const driver = submitDrivers.get(actionPath);
	if (!driver) throw new Error(`no submitted form for ${actionPath}`);
	await driver(result);
}

function boundTableDocument(): DocumentV1 {
	const input: DocumentV1Input = {
		version: 1,
		title: 'Binding Fixture',
		sections: [
			{
				id: 'metrics',
				title: 'Metrics',
				blocks: [
					{
						type: 'table',
						id: 'severity-table',
						columns: [{ key: 'severity', label: 'Severity' }],
						binding: {
							dataSetId: '01970000-0000-7000-8000-0000000000bb',
							fields: [{ name: 'severity', type: 'string', slot: { role: 'column' } }]
						}
					}
				]
			}
		]
	};
	const result = validateDocument(input);
	if (!result.ok) throw new Error('bound fixture must be valid');
	return result.document;
}

function staticTableDocument(): DocumentV1 {
	const input: DocumentV1Input = {
		version: 1,
		title: 'Binding Fixture',
		sections: [
			{
				id: 'metrics',
				title: 'Metrics',
				blocks: [
					{
						type: 'table',
						id: 'severity-table',
						columns: [{ key: 'severity', label: 'Severity' }],
						binding: { fields: [{ name: 'severity', type: 'string' }] }
					}
				]
			}
		]
	};
	const result = validateDocument(input);
	if (!result.ok) throw new Error('static fixture must be valid');
	return result.document;
}

type ReportProp = Parameters<typeof import('./ReportEditor.svelte').default>[1]['report'];

function sampleReport(document: DocumentV1, updatedAt: Date): ReportProp {
	return {
		id: '01970000-0000-7000-8000-000000000001',
		title: 'Binding Fixture',
		status: 'draft',
		schemaVersion: 1,
		document,
		publishedDocument: null,
		publishedAt: null,
		seriesId: '01970000-0000-7000-8000-0000000000c1',
		predecessorId: null,
		issueLabel: null,
		createdAt: new Date('2026-06-12T08:00:00Z'),
		updatedAt
	} as ReportProp;
}

const DATA_SET = {
	id: '01970000-0000-7000-8000-0000000000bb',
	reportId: null,
	filename: 'severity.csv',
	sourceFormat: 'csv' as const,
	fields: [
		{ name: 'severity', type: 'string' as const },
		{ name: 'count', type: 'number' as const }
	],
	injectedAt: new Date('2026-06-12T07:00:00Z')
};

async function renderEditor(report: ReportProp) {
	submitDrivers.clear();
	const { default: ReportEditor } = await import('./ReportEditor.svelte');
	return render(ReportEditor, {
		report,
		dataSets: [DATA_SET],
		skeletons: [],
		aiEnabled: false,
		form: null
	});
}

describe('Editor data binding - token reconciliation (Epic 10.5)', () => {
	it('advances the concurrency token after a bind so the next save asserts the post-bind state', async () => {
		// Load at T0; a bind action returns the bound document + a NEW updatedAt (T1).
		// The editor must reconcile its token to T1, otherwise the next document save
		// would assert the stale T0 and 409 spuriously.
		const loadedAt = new Date('2026-06-12T09:30:00Z');
		const report = sampleReport(staticTableDocument(), loadedAt);
		const screen = await renderEditor(report);

		// The binder shows the loaded saved-at; submit the bind form.
		const bindForm = screen.container.querySelector('form[action="?/bind"]')!;
		(bindForm as HTMLFormElement).requestSubmit();

		const boundAt = '2026-06-12T11:00:00.000Z';
		await drive('?/bind', {
			type: 'success',
			status: 200,
			data: { boundAt, document: boundTableDocument() }
		});

		// The displayed saved-at advances to the bind's timestamp (the visible proxy for
		// the advanced concurrency token: reconcileBinding sets savedAt = expectedUpdatedAt).
		await expect.element(screen.getByText('Saved at', { exact: false })).toBeVisible();
		const savedAtText = screen.container.querySelector('.save-status')!.textContent ?? '';
		// 11:00 UTC is the bound timestamp: it must be shown (the token advanced to it)
		// and the loaded 09:30 must no longer be (the editor moved off the stale value).
		expect(savedAtText).toContain('11:00');
		expect(savedAtText).not.toContain('09:30');
	});

	it('reseeds the working copy from the bound document so the preview renders bound', async () => {
		// A bind re-resolves the block's values from the data set. The editor reseeds its
		// in-edit doc from the action's document, so the preview (the pure renderer) shows
		// the bound result, not the pre-bind static shape.
		const report = sampleReport(staticTableDocument(), new Date('2026-06-12T09:30:00Z'));
		const screen = await renderEditor(report);

		// The bound result renders in the preview; switch the right pane to it ("Preview").
		await screen.getByRole('button', { name: 'Preview' }).click();

		const bound = boundTableDocument();
		// Inject a resolved row into the bound document so the reseed is observable in the
		// preview (a bound block carries the data set's rows).
		const boundBlock = bound.sections[0].blocks[0] as { rows?: Record<string, unknown>[] };
		boundBlock.rows = [{ severity: 'Critical' }];

		(screen.container.querySelector('form[action="?/bind"]') as HTMLFormElement).requestSubmit();
		await drive('?/bind', {
			type: 'success',
			status: 200,
			data: { boundAt: '2026-06-12T11:00:00.000Z', document: bound }
		});

		// The live preview re-renders the bound block from the reseeded doc (the settled
		// snapshot follows the doc reassignment); the resolved cell value appears.
		await expect.element(screen.getByText('Critical')).toBeVisible();
	});

	it('surfaces rebind diagnostics at the block and reconciles the token', async () => {
		// A rebind returns per-block diagnostics; a drifted block shows the chip + inline
		// remap AT the block, and the token advances to the rebind timestamp.
		const report = sampleReport(boundTableDocument(), new Date('2026-06-12T09:30:00Z'));
		const screen = await renderEditor(report);

		const diagnostic: BlockDiagnostic = {
			blockId: 'severity-table',
			blockType: 'table',
			label: 'Metrics - table',
			state: 'drifted',
			drifts: [{ expected: 'count', closest: 'counts', distance: 1 }]
		};

		(screen.container.querySelector('form[action="?/rebind"]') as HTMLFormElement).requestSubmit();
		await drive('?/rebind', {
			type: 'success',
			status: 200,
			data: {
				reboundAt: '2026-06-12T12:00:00.000Z',
				document: boundTableDocument(),
				diagnostics: [diagnostic],
				summary: { total: 1, bound: 0, drifted: 1, unresolved: 0, allGreen: false },
				rebound: []
			}
		});

		// The drift surfaces in the inspector for the SELECTED block (UX redesign: the
		// binding state + remap moved off the card into the right-pane inspector). Select
		// the block, then the inspector shows the chip; open it to reach the inline remap.
		const blockCard = screen.container.querySelector(
			'[data-block-id="severity-table"]'
		) as HTMLElement;
		blockCard.click();
		const inspector = screen.container.querySelector('.inspector')!;
		const chip = await vi.waitFor(() => {
			const found = inspector.querySelector('.binding-state button');
			if (!found) throw new Error('drift chip not in inspector');
			return found;
		});
		expect(chip.textContent ?? '').toContain('Drifted');
		(chip as HTMLButtonElement).click();
		await vi.waitFor(() => {
			expect(inspector.querySelector('form[action="?/remap"]')).not.toBeNull();
		});
	});

	it('gates a bind while the editor is dirty so an unsaved edit is not clobbered', async () => {
		// The DATA-LOSS guard (Epic 10.5): a binding action reseeds the working copy from
		// the SERVER's last-saved document. If the author has an unsaved edit in flight (a
		// typed title the 800 ms autosave has not yet posted), an unguarded bind would
		// overwrite it with the server document. The guard cancels the bind while dirty,
		// so the unsaved title survives and no reconcile runs.
		const report = sampleReport(staticTableDocument(), new Date('2026-06-12T09:30:00Z'));
		const screen = await renderEditor(report);

		// Make the editor dirty with an unsaved title edit (no autosave has landed).
		const titleInput = screen.container.querySelector(
			'input[aria-label="Report title"]'
		) as HTMLInputElement;
		titleInput.value = 'Unsaved Title';
		titleInput.dispatchEvent(new Event('input', { bubbles: true }));

		// Submit the bind: the guard cancels it (dirty), so submitBind returns early and
		// registers no result callback. Even if the test drives a (stale) server document
		// for it, the guard blocked the reconcile, so the unsaved title edit survives.
		const bindForm = screen.container.querySelector('form[action="?/bind"]') as HTMLFormElement;
		bindForm.requestSubmit();
		await drive('?/bind', {
			type: 'success',
			status: 200,
			data: { boundAt: '2026-06-12T11:00:00.000Z', document: boundTableDocument() }
		});
		expect(
			(screen.container.querySelector('input[aria-label="Report title"]') as HTMLInputElement).value
		).toBe('Unsaved Title');
		// The token did NOT advance (no reconcile ran): the displayed saved-at stays at the
		// loaded 09:30, and the guard surfaced the "saving your latest edits" prompt.
		expect(screen.container.querySelector('.save-status')!.textContent ?? '').toContain('09:30');
	});

	it('clears stale per-block diagnostics on a bind after a rebind', async () => {
		// Finding: onRebound surfaces a drift chip at the block; a subsequent BIND
		// re-resolves that block's state from scratch, so the prior drift no longer
		// describes it. onBound must clear the surfaced diagnostics, otherwise a stale
		// amber chip lingers on the just-bound block.
		const report = sampleReport(boundTableDocument(), new Date('2026-06-12T09:30:00Z'));
		const screen = await renderEditor(report);

		const diagnostic: BlockDiagnostic = {
			blockId: 'severity-table',
			blockType: 'table',
			label: 'Metrics - table',
			state: 'drifted',
			drifts: [{ expected: 'count', closest: 'counts', distance: 1 }]
		};

		// A rebind drifts the block: the chip surfaces.
		(screen.container.querySelector('form[action="?/rebind"]') as HTMLFormElement).requestSubmit();
		await drive('?/rebind', {
			type: 'success',
			status: 200,
			data: {
				reboundAt: '2026-06-12T12:00:00.000Z',
				document: boundTableDocument(),
				diagnostics: [diagnostic],
				summary: { total: 1, bound: 0, drifted: 1, unresolved: 0, allGreen: false },
				rebound: []
			}
		});
		// Select the block so the inspector shows its binding state (UX redesign).
		const blockCard = screen.container.querySelector(
			'[data-block-id="severity-table"]'
		) as HTMLElement;
		blockCard.click();
		const inspector = screen.container.querySelector('.inspector')!;
		await vi.waitFor(() => {
			expect(inspector.querySelector('.binding-state button')).not.toBeNull();
		});

		// Now bind: onBound clears the diagnostics, so the drift chip is gone.
		(screen.container.querySelector('form[action="?/bind"]') as HTMLFormElement).requestSubmit();
		await drive('?/bind', {
			type: 'success',
			status: 200,
			data: { boundAt: '2026-06-12T13:00:00.000Z', document: boundTableDocument() }
		});
		await vi.waitFor(() => {
			expect(inspector.querySelector('.binding-state button')).toBeNull();
		});
	});
});
