<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { formatUtcTime } from '$lib/format';
	import type { DocumentV1 } from '$lib/schema';
	import { isBindable } from '$lib/schema';
	import { THEME_OPTIONS, themeFallbackWarning } from '$lib/render';
	import Button from '$lib/ui/Button.svelte';
	import StatusChip from '$lib/ui/StatusChip.svelte';
	import BlockBinder from './BlockBinder.svelte';
	import RefillPanel from './RefillPanel.svelte';
	import GeneratePanel from './GeneratePanel.svelte';
	import IssueList from './IssueList.svelte';
	import SectionEditor from './SectionEditor.svelte';
	import LivePreview from '../preview/LivePreview.svelte';
	import {
		groupErrorsByLocation,
		moveItem,
		newSection,
		optimisticDocumentIssues,
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
		skeletons: PageData['skeletons'];
		aiEnabled: PageData['aiEnabled'];
		form: ActionData;
	}

	let { report, dataSets, skeletons, aiEnabled, form }: Props = $props();

	const editable = $derived(report.status === 'draft');

	// svelte-ignore state_referenced_locally
	let doc = $state(structuredClone(report.document));

	// Theme selection (Story 6.5). The picker offers only known built-in themes;
	// an empty value means "no selection" and renders the default (FR39). A
	// stored document whose `theme` references a removed/unknown theme still
	// loads (the render path falls back to default, AC3) and flags here so the
	// author sees why the report shows the default theme.
	const themeWarning = $derived(themeFallbackWarning(doc.theme));

	function onThemeChange(value: string): void {
		doc.theme = value === '' ? undefined : value;
		onEdit();
	}

	// Data-bindable blocks in the live document (table/chart/kpi), labelled for
	// the binder's block picker. Recomputed as the author adds/removes blocks.
	const bindableBlocks = $derived(
		doc.sections.flatMap((section) =>
			section.blocks.filter(isBindable).map((block) => ({
				id: block.id,
				type: block.type,
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
	// Optimistic concurrency (Epic 10.1): the `updatedAt` the next save asserts.
	// Seeded from the loaded row and advanced to each successful save's timestamp,
	// so a write that lands after a concurrent edit (a second tab, an API push, an
	// MCP write) is the 409 conflict the editor surfaces, never a silent overwrite.
	// svelte-ignore state_referenced_locally
	let expectedUpdatedAt = $state(report.updatedAt.toISOString());
	// True once a save came back 409: the in-memory edits are ahead of a newer
	// server state, so the author must reload to reconcile before saving again.
	let conflict = $state(false);
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

	// Optimistic client validation (Epic 10.1): the editor parses the live in-edit
	// document against the SAME isomorphic `documentSchemaV1` the server validates
	// with, so a problem is placed inline at the failing block BEFORE any round-trip.
	// Guidance, never a gate - the author keeps editing, and the server
	// validate-on-write stays the only authority (an invalid document is rejected
	// there even if this passed). Issues are grouped against the LIVE document so
	// they track the block the author is editing. `optimisticDocumentIssues` reuses
	// the per-block/section schemas the renderer already ships, so it adds zero bytes
	// to the reader path (it never imports the server-side validate-on-write helper).
	const optimisticIssues: EditorIssue[] = $derived(optimisticDocumentIssues($state.snapshot(doc)));

	// What the inline placement renders. After a JS save that FAILED, the server's
	// authoritative errors (`clientErrors`) take precedence and map against the
	// submitted document. Otherwise the optimistic client issues guide the live
	// document. The no-JS fallback (`form?.errors`) stands in before any JS save.
	const issues: EditorIssue[] = $derived(
		clientErrors !== null && clientErrors.length > 0
			? clientErrors
			: (form?.errors ?? optimisticIssues)
	);
	const errorsByKey: ErrorsByKey = $derived(
		groupErrorsByLocation(
			issues,
			clientErrors !== null && clientErrors.length > 0 ? (submittedDoc ?? doc) : doc
		)
	);
	const documentIssues: EditorIssue[] = $derived(errorsByKey['document'] ?? []);
	const failureMessage: string | null = $derived(
		saveMessage ??
			(clientErrors === null && (form?.errors?.length ?? 0) === 0 ? (form?.message ?? null) : null)
	);

	// The authoritative live preview (Epic 10.1): a plain snapshot of the in-edit
	// document, fed to the SAME pure `$lib/render` tier the reader SSR path uses
	// (through the embedded LivePreview). What the author edits is what the reader
	// gets - this is the reader render, not a lookalike. The snapshot re-derives on
	// every edit so the preview tracks the document live; a transiently-invalid
	// snapshot still renders (LivePreview goes through `toPreviewView`, which renders
	// valid blocks and flags invalid ones rather than crashing).
	const previewSnapshot = $derived($state.snapshot(doc));

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
		// Assert the loaded/last-saved `updatedAt`: the service rejects a write that
		// lands after a concurrent edit as a 409 conflict (optimistic concurrency).
		formData.set('expectedUpdatedAt', expectedUpdatedAt);
		saving = true;
		return async ({ result }) => {
			saving = false;
			if (result.type === 'success') {
				dirty = false;
				conflict = false;
				clientErrors = [];
				saveMessage = null;
				const payload = result.data as { savedAt?: string } | undefined;
				if (payload?.savedAt) {
					savedAt = payload.savedAt;
					// Advance the concurrency token so the NEXT save asserts against the
					// state this save just wrote, not the stale loaded value.
					expectedUpdatedAt = payload.savedAt;
				}
			} else if (result.type === 'failure') {
				if (result.status === 409) {
					// A concurrent write landed between load and save: surface the conflict
					// and the resolve path (reload). Do NOT advance the token or clear the
					// in-memory edits - the author reloads to reconcile, never a silent
					// last-writer-wins overwrite.
					conflict = true;
					clientErrors = [];
					const payload = result.data as { message?: string } | undefined;
					saveMessage =
						payload?.message ??
						'This report changed since you opened it. Reload to get the latest version, then reapply your edits.';
					return;
				}
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
				// publish wrote a new `updatedAt`; reconcile the concurrency token so a
				// later unpublish-then-edit save asserts the latest state, not the stale
				// pre-publish value.
				expectedUpdatedAt = report.updatedAt.toISOString();
				savedAt = expectedUpdatedAt;
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
				conflict = false;
				await invalidateAll();
				// unpublish wrote a new `updatedAt`; reconcile the concurrency token so
				// the first edit-and-save after returning to draft asserts the latest
				// state instead of a stale one (a spurious 409).
				expectedUpdatedAt = report.updatedAt.toISOString();
				savedAt = expectedUpdatedAt;
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
	// svelte-ignore state_referenced_locally
	const changesPath = resolve('/(workspace)/reports/[id]/changes', { id: report.id });
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
			<a class="toolbar-link" href={changesPath}>What changed</a>
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

<div class="editor-layout">
	<form
		method="POST"
		action="?/save"
		use:enhance={submitSave}
		bind:this={saveFormElement}
		class="editor-form"
	>
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

			<div class="report-settings">
				<label class="theme-field">
					<span class="theme-label">Theme</span>
					<select
						class="theme-select"
						value={doc.theme ?? ''}
						onchange={(event) => onThemeChange(event.currentTarget.value)}
					>
						<option value="">Default (Modern Gazette)</option>
						{#each THEME_OPTIONS as option (option.name)}
							{#if option.name !== 'default'}
								<option value={option.name}>{option.label}</option>
							{/if}
						{/each}
					</select>
				</label>
				{#if themeWarning}
					<p class="theme-warning" role="status">{themeWarning.message}</p>
				{/if}
			</div>

			{#if !editable}
				<p class="published-note">
					This report is published and read-only. Readers see the snapshot taken at publish.
					Unpublish above to edit or delete it.
				</p>
			{/if}

			{#if conflict}
				<!-- Optimistic-concurrency conflict (Epic 10.1): a concurrent write landed
			     between load and save. The edits stay in memory; reloading reconciles
			     against the latest server state so the author reapplies, never a silent
			     last-writer-wins overwrite. -->
				<div class="conflict" role="alert">
					<p class="conflict-message">{saveMessage}</p>
					<Button type="button" variant="secondary" onclick={() => invalidateAll()}>
						Reload latest
					</Button>
				</div>
			{:else if failureMessage}
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

	<!-- Authoritative live preview (Epic 10.1): the editor reuses the SAME embedded
	     LivePreview the /preview route uses, fed the LIVE in-edit snapshot so it
	     re-renders through the pure `$lib/render` tier on every edit. What the author
	     edits is what the reader gets - the preview IS the reader render. -->
	<aside class="editor-preview" aria-label="Live preview">
		<LivePreview document={previewSnapshot} />
	</aside>
</div>

<BlockBinder blocks={bindableBlocks} {dataSets} disabled={!editable} />

<RefillPanel {dataSets} disabled={!editable} />

<!-- UX Flow D (FR32): the Generate-with-AI entry point appears only when the
     connector is configured + opted-in; a disabled instance hides it entirely so
     the workspace never offers a capability that 503s. -->
{#if aiEnabled}
	<GeneratePanel {skeletons} {dataSets} disabled={!editable} />
{/if}

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

	/* Two-pane editor shell (Epic 10.1): the form on the left, the authoritative
	   live preview on the right. The preview is sticky so it stays in view while the
	   author scrolls the form. On a narrow viewport the panes stack (the editor is a
	   desktop surface, NFR27 is a reader requirement, so this is graceful degradation
	   not a mobile authoring target). */
	.editor-layout {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--space-5);
	}

	.editor-form {
		flex: 1 1 440px;
		min-width: 0;
		margin: 0;
	}

	.editor-preview {
		flex: 1 1 440px;
		min-width: 0;
		position: sticky;
		top: var(--space-4);
	}

	.editor {
		margin: 0;
		padding: 0;
		border: 0;
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

	.report-settings {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3) var(--space-4);
		margin-bottom: var(--space-4);
	}

	.theme-field {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.theme-label {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink-65);
	}

	.theme-select {
		padding: var(--space-1) var(--space-3);
		font: inherit;
		font-size: var(--text-sm);
		color: var(--color-ink);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	/* Theme fallback warning (AC3): the report references a removed/unknown theme,
	   so the reader sees the default. Amber, not danger - the report still renders
	   cleanly; this is advisory, not a validation error. */
	.theme-warning {
		margin: 0;
		padding: var(--space-2) var(--space-4);
		font-size: var(--text-sm);
		color: var(--color-amber);
		background: var(--color-amber-12);
		border-radius: var(--radius-sm);
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

	/* Optimistic-concurrency conflict (Epic 10.1): an amber, actionable banner with
	   the resolve path (reload), distinct from the danger-toned validation problem -
	   the edits are intact, the report just moved on under the author. */
	.conflict {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		color: var(--color-ink);
		background: var(--color-amber-12);
		border: 1px solid var(--color-amber);
		border-radius: var(--radius-sm);
	}

	.conflict-message {
		margin: 0;
		font-size: var(--text-sm);
	}

	.add-section {
		margin-top: var(--space-4);
	}
</style>
