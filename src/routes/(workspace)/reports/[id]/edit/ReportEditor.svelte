<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { DocumentV1 } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import StatusChip from '$lib/ui/StatusChip.svelte';
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
	// report once at init is the intended lifecycle (fresh state per report).
	interface Props {
		report: PageData['report'];
		form: ActionData;
	}

	let { report, form }: Props = $props();

	// svelte-ignore state_referenced_locally
	const editable = report.status === 'draft';

	// svelte-ignore state_referenced_locally
	let doc = $state(structuredClone(report.document));
	let dirty = $state(false);
	let saving = $state(false);
	// svelte-ignore state_referenced_locally
	let savedAt = $state(report.updatedAt.toISOString());
	// null = no JS save yet (fall back to the server-rendered `form` prop, the
	// no-JS path); [] = last JS save succeeded; entries = last JS save failed.
	let clientErrors = $state<EditorIssue[] | null>(null);
	let saveMessage = $state<string | null>(null);
	let submittedDoc: DocumentV1 | null = null;
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

	function savedAtLabel(iso: string): string {
		return `Saved at ${iso.slice(11, 16)} UTC`;
	}
</script>

<svelte:head>
	<title>{doc.title} - Acta Diurna</title>
</svelte:head>

<svelte:window
	onbeforeunload={(event) => {
		if (dirty) event.preventDefault();
	}}
/>

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
				This report is published and read-only. Lifecycle changes arrive with publishing (story
				1.7).
			</p>
		{/if}

		{#if failureMessage}
			<p class="problem" role="alert">{failureMessage}</p>
		{/if}

		{#if documentIssues.length > 0}
			<ul class="document-issues" role="alert">
				{#each documentIssues as issue (issue.path + issue.message)}
					<li>
						<strong>{issue.message}</strong>
						{#if issue.hint}<span class="hint">{issue.hint}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#each doc.sections as section, sectionIndex (section.id)}
			<SectionEditor
				bind:section={doc.sections[sectionIndex]}
				{sectionIndex}
				count={doc.sections.length}
				errors={errorsByKey}
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

<style>
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
		font-size: 12px;
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

	.document-issues {
		margin: 0 0 var(--space-4);
		padding: var(--space-3) var(--space-5);
		color: var(--color-danger);
		background: var(--color-danger-08);
		border-radius: var(--radius-sm);
	}

	.document-issues .hint {
		display: block;
		color: var(--color-ink-65);
	}

	.add-section {
		margin-top: var(--space-4);
	}
</style>
