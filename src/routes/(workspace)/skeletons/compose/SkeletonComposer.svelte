<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { BRICKS, getBrick } from '$lib/bricks';
	import type { DocumentV1Input } from '$lib/schema';
	import BrickCard from '$lib/ui/BrickCard.svelte';
	import Button from '$lib/ui/Button.svelte';
	import LivePreview from '../../reports/[id]/preview/LivePreview.svelte';
	import IssueList from '../../reports/[id]/edit/IssueList.svelte';
	import StructureTree from './StructureTree.svelte';
	import {
		appendBrick,
		groupErrorsByLocation,
		newSkeletonDraft,
		type EditorIssue,
		type ErrorsByKey
	} from './compose-state';
	import type { ActionData } from './$types';

	// Three-zone composer (UX Flow A): left brick library, center StructureTree,
	// right LivePreview (the identical render tier). Owns the in-memory skeleton
	// draft. Save validates server-side; an invalid structure (empty section,
	// empty title) comes back as errors[] rendered inline at the offending element
	// via the reused 1.5 IssueList + error grouping. Save persists to the skeletons
	// table and redirects to the library (/skeletons).
	interface Props {
		form: ActionData;
	}

	let { form }: Props = $props();

	const coverBrick = getBrick('cover')!;
	let draft = $state<DocumentV1Input>(newSkeletonDraft(coverBrick));
	let saving = $state(false);
	// null = no JS save yet (fall back to the server `form` prop); [] = success;
	// entries = the last save failed. Mirrors the 1.5 editor's clientErrors model.
	let clientErrors = $state<EditorIssue[] | null>(null);
	let saveMessage = $state<string | null>(null);
	let submittedDoc = $state<DocumentV1Input | null>(null);

	const issues: EditorIssue[] = $derived(clientErrors ?? form?.errors ?? []);
	const errorsByKey: ErrorsByKey = $derived(groupErrorsByLocation(issues, submittedDoc ?? draft));
	const documentIssues: EditorIssue[] = $derived(errorsByKey['document'] ?? []);
	const failureMessage: string | null = $derived(
		saveMessage ?? (clientErrors === null && issues.length === 0 ? (form?.message ?? null) : null)
	);

	function onChange(): void {
		// A structural change invalidates the last save outcome so stale inline
		// errors do not linger on elements the author just fixed or removed.
		clientErrors = null;
		saveMessage = null;
	}

	const submitSave: SubmitFunction = ({ formData }) => {
		const snapshot = $state.snapshot(draft) as DocumentV1Input;
		submittedDoc = snapshot;
		formData.set('document', JSON.stringify(snapshot));
		saving = true;
		return async ({ result }) => {
			saving = false;
			if (result.type === 'redirect') {
				// Save persisted: the action redirects to the library. Let the default
				// action handler perform the navigation.
				clientErrors = [];
				saveMessage = null;
				await applyAction(result);
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
</script>

<svelte:head>
	<title>Compose a skeleton - Acta Diurna</title>
</svelte:head>

<form method="POST" action="?/save" use:enhance={submitSave}>
	<div class="composer-header">
		<input
			class="skeleton-title"
			name="title"
			value={draft.title}
			oninput={(event) => {
				draft.title = event.currentTarget.value;
				onChange();
			}}
			aria-label="Skeleton name"
		/>
		<div class="save-state">
			<Button type="submit" variant="primary" disabled={saving}>
				{saving ? 'Saving...' : 'Save skeleton'}
			</Button>
		</div>
	</div>

	{#if failureMessage}
		<p class="problem" role="alert">{failureMessage}</p>
	{/if}

	<IssueList issues={documentIssues} variant="document" />

	<div class="zones">
		<aside class="zone library" aria-label="Brick library">
			<h2>Bricks</h2>
			{#each BRICKS as brick (brick.id)}
				<BrickCard
					{brick}
					onAdd={() => {
						appendBrick(draft.sections, brick);
						onChange();
					}}
				/>
			{/each}
		</aside>

		<div class="zone structure-zone">
			<h2>Structure</h2>
			<StructureTree bind:sections={draft.sections} errors={errorsByKey} {onChange} />
		</div>

		<div class="zone preview-zone" aria-label="Live preview">
			<LivePreview document={draft} />
		</div>
	</div>
</form>

<style>
	.composer-header {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}

	.skeleton-title {
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

	.skeleton-title:hover,
	.skeleton-title:focus {
		background: var(--color-surface);
		border-color: var(--color-ink-25);
	}

	.save-state {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.problem {
		padding: var(--space-3) var(--space-4);
		margin-bottom: var(--space-3);
		color: var(--color-danger);
		background: var(--color-danger-08);
		border-radius: var(--radius-sm);
	}

	/* Three zones at the composer full-layout breakpoint (1280px token); the
	   library collapses into the flow below that, per the UX responsive note.
	   The preview keeps a comfortable minimum so the real renderer is not
	   squeezed below its natural prose width (which clipped long lines). */
	.zones {
		display: grid;
		grid-template-columns: 220px minmax(0, 1fr) minmax(420px, 1.3fr);
		gap: var(--space-4);
		align-items: start;
	}

	@media (max-width: 1280px) {
		.zones {
			grid-template-columns: minmax(0, 1fr) minmax(360px, 1.2fr);
		}

		.library {
			grid-column: 1 / -1;
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
			gap: var(--space-2);
		}

		.library h2 {
			grid-column: 1 / -1;
		}
	}

	@media (max-width: 880px) {
		.zones {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.zone {
		min-width: 0;
	}

	/* Let the preview scroll horizontally rather than clip the rendered report
	   if the column is still tighter than its natural prose width. */
	.preview-zone {
		overflow-x: auto;
	}

	.library {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.zone h2 {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-ink-65);
	}
</style>
