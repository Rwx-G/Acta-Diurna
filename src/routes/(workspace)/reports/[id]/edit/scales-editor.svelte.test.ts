import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { DocumentV1 } from '$lib/schema';
import ScalesEditor from './ScalesEditor.svelte';

// A working copy whose `severity` scale is referenced by a comparison-matrix
// (severityScale + a finding using the `high` entry) and whose `sources` scale is
// referenced too (sourceScale). The `extra` scale and the `low` entry are referenced
// by nothing, so the delete guard must let them go while blocking the referenced ones.
function makeDoc(): DocumentV1 {
	return {
		version: 1,
		title: 'Audit',
		scales: [
			{
				key: 'severity',
				label: 'Severity',
				kind: 'ordinal',
				entries: [
					{ key: 'high', label: 'High' },
					{ key: 'low', label: 'Low' }
				]
			},
			{
				key: 'sources',
				label: 'Sources',
				kind: 'nominal',
				entries: [{ key: 'siem', label: 'SIEM' }]
			},
			{ key: 'extra', label: 'Extra', kind: 'nominal', entries: [{ key: 'a', label: 'A' }] }
		],
		sections: [
			{
				id: 's',
				title: 'S',
				blocks: [
					{
						type: 'comparison-matrix',
						id: 'm',
						severityScale: 'severity',
						sourceScale: 'sources',
						findings: [{ severity: 'high', sources: { siem: { state: 'found' } } }]
					}
				]
			}
		]
	} as unknown as DocumentV1;
}

function openAll(container: HTMLElement): void {
	for (const details of container.querySelectorAll('details')) {
		(details as HTMLDetailsElement).open = true;
	}
}

function input(container: HTMLElement, label: string): HTMLInputElement {
	const el = container.querySelector(`input[aria-label="${label}"]`);
	if (!el) throw new Error(`no input labelled "${label}"`);
	return el as HTMLInputElement;
}

/** Sets a value and fires the native `change` event (the key fields commit on change). */
function commit(el: HTMLInputElement, value: string): void {
	el.value = value;
	el.dispatchEvent(new Event('change', { bubbles: true }));
}

function scaleKeys(container: HTMLElement): string[] {
	return [...container.querySelectorAll('.scale-key-chip')].map((el) => el.textContent ?? '');
}

function scaleCardCount(container: HTMLElement): number {
	return container.querySelectorAll('.scale-card').length;
}

describe('ScalesEditor', () => {
	it('lists the document scales with their keys once expanded', async () => {
		const { container } = render(ScalesEditor, {
			doc: makeDoc(),
			editable: true,
			onEdit: vi.fn()
		});
		openAll(container);

		expect(scaleKeys(container)).toEqual(['severity', 'sources', 'extra']);
	});

	it('renames a scale key on commit and shows the new key (cascade applied)', async () => {
		const onEdit = vi.fn();
		const { container, getByText } = render(ScalesEditor, {
			doc: makeDoc(),
			editable: true,
			onEdit
		});
		openAll(container);

		commit(input(container, 'Scale 1 key'), 'criticite');

		await expect.element(getByText('criticite')).toBeVisible();
		expect(onEdit).toHaveBeenCalled();
	});

	it('rejects an invalid key with a notice and reverts the field, without editing', async () => {
		const onEdit = vi.fn();
		const { container, getByRole } = render(ScalesEditor, {
			doc: makeDoc(),
			editable: true,
			onEdit
		});
		openAll(container);

		const keyInput = input(container, 'Scale 1 key');
		commit(keyInput, 'Bad Key');

		await expect.element(getByRole('alert')).toBeVisible();
		expect(keyInput.value).toBe('severity');
		expect(onEdit).not.toHaveBeenCalled();
	});

	it('rejects a duplicate key with a notice', async () => {
		const { container, getByRole } = render(ScalesEditor, {
			doc: makeDoc(),
			editable: true,
			onEdit: vi.fn()
		});
		openAll(container);

		commit(input(container, 'Scale 1 key'), 'sources');

		await expect.element(getByRole('alert')).toBeVisible();
	});

	it('blocks deleting a referenced scale and keeps it', async () => {
		const onEdit = vi.fn();
		const { container, getByRole } = render(ScalesEditor, {
			doc: makeDoc(),
			editable: true,
			onEdit
		});
		openAll(container);

		await getByRole('button', { name: 'Delete scale' }).first().click();

		await expect.element(getByRole('alert')).toBeVisible();
		expect(scaleKeys(container)).toContain('severity');
		expect(scaleCardCount(container)).toBe(3);
		expect(onEdit).not.toHaveBeenCalled();
	});

	it('deletes an unreferenced scale', async () => {
		const onEdit = vi.fn();
		// The component mutates the passed working copy in place; assert on it directly
		// (the bindable prop is not a deep $state proxy under the test harness, so the
		// `{#each}` does not re-render off an in-place splice - it does in the real editor
		// where `doc` is $state - but the mutation still writes through to this object).
		const doc = makeDoc();
		const { container } = render(ScalesEditor, { doc, editable: true, onEdit });
		openAll(container);

		// The third "Delete scale" control belongs to the unreferenced `extra` scale.
		const deletes = container.querySelectorAll('button[aria-label="Delete scale"]');
		(deletes[2] as HTMLButtonElement).click();

		await vi.waitFor(() => expect(doc.scales?.length).toBe(2));
		expect(doc.scales?.map((scale) => scale.key)).not.toContain('extra');
		expect(onEdit).toHaveBeenCalled();
	});

	it('adds a scale', async () => {
		const onEdit = vi.fn();
		const doc = makeDoc();
		const { container, getByRole } = render(ScalesEditor, { doc, editable: true, onEdit });
		openAll(container);

		await getByRole('button', { name: 'Add scale' }).click();

		await vi.waitFor(() => expect(doc.scales?.length).toBe(4));
		expect(onEdit).toHaveBeenCalled();
		// The new scale and its entry carry non-empty labels: the schema requires a min-1
		// label on both, so an empty default would make the document invalid and block the
		// autosave the moment a scale is added.
		const added = doc.scales?.[3];
		expect(added?.label).not.toBe('');
		expect(added?.entries[0].label).not.toBe('');
	});

	it('disables every control when the report is not editable', async () => {
		const { container } = render(ScalesEditor, {
			doc: makeDoc(),
			editable: false,
			onEdit: vi.fn()
		});
		openAll(container);

		expect(input(container, 'Scale 1 key').disabled).toBe(true);
		for (const button of container.querySelectorAll('.panel-body button')) {
			expect((button as HTMLButtonElement).disabled).toBe(true);
		}
	});
});
