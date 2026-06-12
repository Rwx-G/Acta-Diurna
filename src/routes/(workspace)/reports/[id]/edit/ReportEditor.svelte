<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { formatUtcTime } from '$lib/format';
	import type { DocumentV1 } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import StatusChip from '$lib/ui/StatusChip.svelte';
	import BlockBinder from './BlockBinder.svelte';
	import RefillPanel from './RefillPanel.svelte';
	import IssueList from './IssueList.svelte';
	import SectionEditor from './SectionEditor.svelte';
	import {
		groupErrorsByLocation,
		moveItem,
		newSection,
		type EditorIssue,
		type ErrorsByKey
	} from './editor-state';
	import type { ActionData, PageData } from './$types';

	// The page remounts this component via {#key report.id}, so capturing the
	// document once at init is the intended lifecycle (fresh state per report).
	// The lifecycle status, by contrast, is read live off the prop so publish /
	// unpublish (which invalidateAll to refresh `report`) flip the editor between
	// editable and read-only without losing the in-memory document.
	interface Props {
		report: PageData['report'];
		dataSets: PageData['dataSets'];
		form: ActionData;
	}

	let { report, dataSets, form }: Props = $props();

	const editable = $derived(report.status === 'draft');

	// svelte-ignore state_referenced_locally
	let doc = $state(structuredClone(report.document));

	// Data-bindable blocks in the live document (table/chart/kpi), labelled for
	// the binder's block picker. Recomputed as the author adds/removes blocks.
	const BINDABLE = new Set(['table', 'chart', 'kpi']);
	const bindableBlocks = $derived(
		doc.sections.flatMap((section) =>
			section.blocks
				.filter((block) => BINDABLE.has(block.type))
				.map((block) => ({
					id: block.id,
					type: block.type as 'table' | 'chart' | 'kpi',
					label: `${section.title} - ${block.type}`
				}))
		)
	);

	// The comparison-matrix blocks in the live document, for the set-membership
	// block editor's source picker (story 7.4): a set-membership block references
	// one by id. Recomputed as the author adds/removes matrices.
	const matrixBlocks = $derived(
		doc.sections.flatMap((section) =>
			section.blocks
				.filter((block) => block.type === 'comparison-matrix')
				.map((block) => ({ id: block.id, label: `${section.title} - ${block.id}` }))
		)
	);

	let dirty = $state(false);
	let saving = $state(false);
	// svelte-ignore state_referenced_locally
	let savedAt = $state(report.updatedAt.toISOString());
	// null = no JS save yet (fall back to the server-rendered `form` prop, the
	// no-JS path); [] = last JS save succeeded; entries = last JS save failed.
	let clientErrors = $state<EditorIssue[] | null>(null);
	let saveMessage = $state<string | null>(null);
	// Reactive: the error-to-block mapping below maps issues against the document
	// that was SUBMITTED (the one the server rejected), not the live doc. As a
	// plain `let` the $derived captured the initial null and never re-grouped
	// after a save reassigned it; $state makes the reassignment reactive.
	let submittedDoc = $state<DocumentV1 | null>(null);
	let saveFormElement: HTMLFormElement | undefined = $state();
	let autosaveTimer: ReturnType<typeof setTimeout> | undefined;

	const issues: EditorIssue[] = $derived(clientErrors ?? form?.errors ?? []);
	const errorsByKey: ErrorsByKey = $derived(groupErrorsByLocation(issues, submittedDoc ?? doc));
	const documentIssues: EditorIssue[] = $derived(errorsByKey['document'] ?? []);
	const failureMessage: string | null = $derived(
		saveMessage ?? (clientErrors === null && issues.length === 0 ? (form?.message ?? null) : null)
	);

	/*
	 * Autosave choice (story 1.5): the save form is a real form action with a
	 * visible Save button (no-JS baseline posts the named narrative fields).
	 * With JS, every edit debounces 800 ms then calls requestSubmit(), so the
	 * autosave and the manual Save share one code path through use:enhance;
	 * the enhance callback injects the serialized document and applies the
	 * result without a data reload (a reload would clobber in-flight edits).
	 * A beforeunload guard covers the window between an edit and its save.
	 */
	const AUTOSAVE_DEBOUNCE_MS = 800;

	function onEdit(): void {
		if (!editable) return;
		dirty = true;
		clearTimeout(autosaveTimer);
		autosaveTimer = setTimeout(() => saveFormElement?.requestSubmit(), AUTOSAVE_DEBOUNCE_MS);
	}

	const submitSave: SubmitFunction = ({ formData, cancel }) => {
		if (!editable) {
			cancel();
			return;
		}
		if (saving) {
			// A save is in flight: drop this one and reschedule so the latest
			// state still lands.
			cancel();
			onEdit();
			return;
		}
		clearTimeout(autosaveTimer);
		const snapshot = $state.snapshot(doc) as DocumentV1;
		submittedDoc = snapshot;
		formData.set('document', JSON.stringify(snapshot));
		saving = true;
		return async ({ result }) => {
			saving = false;
			if (result.type === 'success') {
				dirty = false;
				clientErrors = [];
				saveMessage = null;
				const payload = result.data as { savedAt?: string } | undefined;
				if (payload?.savedAt) savedAt = payload.savedAt;
			} else if (result.type === 'failure') {
				const payload = result.data as { errors?: EditorIssue[]; message?: string } | undefined;
				clientErrors = payload?.errors ?? [];
				saveMessage = clientErrors.length === 0 ? (payload?.message ?? 'Save failed.') : null;
			} else if (result.type === 'error') {
				clientErrors = [];
				saveMessage = 'Save failed: the server could not be reached.';
			}
		};
	};

	let publishing = $state(false);

	// Morphing primary action (UX): a draft is published from here; publishing
	// validates server-side, so an invalid draft comes back as the same errors[]
	// the save path renders inline at the failing blocks. A published report
	// reverts to draft to resume editing. Both refresh `report` via invalidateAll
	// so the editor flips read-only/editable without a full remount.
	const submitPublish: SubmitFunction = ({ cancel }) => {
		if (saving || dirty) {
			// A draft save is in flight or pending: publishing now could freeze a
			// stale snapshot. Cancel and let the autosave land; the author retries.
			cancel();
			saveMessage = 'Saving your latest edits - try publishing again in a moment.';
			return;
		}
		publishing = true;
		return async ({ result }) => {
			publishing = false;
			if (result.type === 'success') {
				clientErrors = [];
				saveMessage = null;
				await invalidateAll();
			} else if (result.type === 'failure') {
				const payload = result.data as { errors?: EditorIssue[]; message?: string } | undefined;
				submittedDoc = $state.snapshot(doc) as DocumentV1;
				clientErrors = payload?.errors ?? [];
				saveMessage = clientErrors.length === 0 ? (payload?.message ?? 'Publish failed.') : null;
			} else if (result.type === 'error') {
				clientErrors = [];
				saveMessage = 'Publish failed: the server could not be reached.';
			}
		};
	};

	const submitUnpublish: SubmitFunction = () => {
		publishing = true;
		return async ({ result }) => {
			publishing = false;
			if (result.type === 'success') {
				clientErrors = [];
				saveMessage = null;
				await invalidateAll();
			} else if (result.type === 'failure') {
				const payload = result.data as { message?: string } | undefined;
				saveMessage = payload?.message ?? 'Unpublish failed.';
			}
		};
	};

	function savedAtLabel(iso: string): string {
		return `Saved at ${formatUtcTime(iso)}`;
	}

	// Keyed remount per report id (the page wraps this in {#key report.id}), so
	// reading the id once at init is the intended lifecycle.
	// svelte-ignore state_referenced_locally
	const previewPath = resolve('/(workspace)/reports/[id]/preview', { id: report.id });
	// svelte-ignore state_referenced_locally
	const viewPath = resolve('/(workspace)/reports/[id]/view', { id: report.id });
	// svelte-ignore state_referenced_locally
	const sharePath = resolve('/(workspace)/reports/[id]/share', { id: report.id });
</script>

<svelte:head>
	<title>{doc.title} - Acta Diurna</title>
</svelte:head>

<svelte:window
	onbeforeunload={(event) => {
		if (dirty) event.preventDefault();
	}}
/>

<div class="editor-toolbar">
	<nav class="toolbar-nav" aria-label="Report views">
		<a class="toolbar-link" href={previewPath} data-sveltekit-preload-data="off">Live preview</a>
		<a class="toolbar-link" href={viewPath} data-sveltekit-preload-data="off">View as reader</a>
		{#if !editable}
			<a class="toolbar-link" href={sharePath}>Share</a>
		{/if}
	</nav>

	<!-- Morphing primary action (UX): publish a draft, or unpublish to edit a
	     published report. Kept outside the editor fieldset so the unpublish
	     control stays enabled while the read-only fieldset is disabled. -->
	{#if editable}
		<form method="POST" action="?/publish" use:enhance={submitPublish} class="lifecycle">
			<Button type="submit" variant="primary" disabled={publishing || saving}>
				{publishing ? 'Publishing...' : 'Publish'}
			</Button>
		</form>
	{:else}
		<form method="POST" action="?/unpublish" use:enhance={submitUnpublish} class="lifecycle">
			<span class="lifecycle-note">Published - unpublish to edit</span>
			<Button type="submit" variant="secondary" disabled={publishing}>
				{publishing ? 'Unpublishing...' : 'Unpublish'}
			</Button>
		</form>
	{/if}
</div>

<form method="POST" action="?/save" use:enhance={submitSave} bind:this={saveFormElement}>
	<fieldset class="editor" disabled={!editable}>
		<div class="editor-header">
			<input
				class="report-title"
				name="title"
				value={doc.title}
				oninput={(event) => {
					doc.title = event.currentTarget.value;
					onEdit();
				}}
				aria-label="Report title"
			/>
			<StatusChip status={report.status} />
			<div class="save-state">
				{#if editable}
					<Button type="submit" variant="secondary">Save</Button>
				{/if}
				<span class="saved-at" aria-live="polite">
					{saving ? 'Saving...' : savedAtLabel(savedAt)}
				</span>
			</div>
		</div>

		{#if !editable}
			<p class="published-note">
				This report is published and read-only. Readers see the snapshot taken at publish. Unpublish
				above to edit or delete it.
			</p>
		{/if}

		{#if failureMessage}
			<p class="problem" role="alert">{failureMessage}</p>
		{/if}

		<IssueList issues={documentIssues} variant="document" />

		{#each doc.sections as section, sectionIndex (section.id)}
			<SectionEditor
				bind:section={doc.sections[sectionIndex]}
				{sectionIndex}
				count={doc.sections.length}
				errors={errorsByKey}
				scales={doc.scales}
				{matrixBlocks}
				{onEdit}
				onRemove={() => {
					doc.sections.splice(sectionIndex, 1);
					onEdit();
				}}
				onMove={(direction) => {
					moveItem(doc.sections, sectionIndex, direction);
					onEdit();
				}}
			/>
		{/each}

		<div class="add-section">
			<Button
				onclick={() => {
					doc.sections.push(newSection());
					onEdit();
				}}
			>
				Add section
			</Button>
		</div>
	</fieldset>
</form>

<BlockBinder blocks={bindableBlocks} {dataSets} disabled={!editable} />

<RefillPanel {dataSets} disabled={!editable} />

<style>
	.editor-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3) var(--space-5);
		max-width: 880px;
		margin-bottom: var(--space-5);
	}

	.toolbar-nav {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.lifecycle {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0;
		margin-left: auto;
	}

	.lifecycle-note {
		font-size: var(--text-sm);
		color: var(--color-ink-65);
		white-space: nowrap;
	}

	.toolbar-link {
		padding: var(--space-2) var(--space-4);
		font-weight: 600;
		font-size: var(--text-base);
		color: var(--color-ink);
		text-decoration: none;
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.toolbar-link:hover {
		border-color: var(--color-purple);
		color: var(--color-purple);
	}

	.editor {
		margin: 0;
		padding: 0;
		border: 0;
		max-width: 880px;
	}

	.editor-header {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}

	.report-title {
		flex: 1;
		min-width: 0;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-size: 20px;
		font-weight: 600;
		color: inherit;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
	}

	.report-title:hover,
	.report-title:focus {
		background: var(--color-surface);
		border-color: var(--color-ink-25);
	}

	.save-state {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.saved-at {
		color: var(--color-ink-65);
		font-size: var(--text-sm);
		white-space: nowrap;
	}

	.published-note {
		padding: var(--space-3) var(--space-4);
		color: var(--color-ink-65);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	.problem {
		padding: var(--space-3) var(--space-4);
		color: var(--color-danger);
		background: var(--color-danger-08);
		border-radius: var(--radius-sm);
	}

	.add-section {
		margin-top: var(--space-4);
	}
</style>
