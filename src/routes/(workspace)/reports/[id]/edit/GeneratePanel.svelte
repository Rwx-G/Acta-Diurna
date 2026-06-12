<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Button from '$lib/ui/Button.svelte';
	import type { Outline } from '$lib/server/ai/generate';
	import type { PageData } from './$types';

	// UX Flow D - outline-first generation (story 5.4). The author requests an
	// outline (intent + optional skeleton + optional data set), reviews and edits
	// it inline, approves, then the draft fills. The panel is rendered ONLY when
	// AI is enabled (the parent hides it otherwise), so it never offers a
	// capability that would 503. Generation replaces the draft document, so it is
	// disabled on a published (read-only) report.
	interface Props {
		skeletons: PageData['skeletons'];
		dataSets: PageData['dataSets'];
		disabled: boolean;
	}

	let { skeletons, dataSets, disabled }: Props = $props();

	let intent = $state('');
	let skeletonId = $state('');
	let dataSetId = $state('');

	// The outline under review, edited in place. null = no outline yet (request
	// stage). When the author edits any field, the approval is invalidated: the
	// posted hash is the one the server minted for the UNEDITED outline, so a
	// since-edited outline is rejected at fill (the re-approval AC), but we also
	// re-request a fresh outline rather than post a knowingly stale one.
	let outline = $state<Outline | null>(null);
	let outlineHash = $state('');
	let requesting = $state(false);
	let filling = $state(false);
	let message = $state<string | null>(null);
	let stage = $state<'request' | 'review' | 'done'>('request');

	const submitOutline: SubmitFunction = ({ cancel }) => {
		if (!intent.trim()) {
			cancel();
			message = 'Describe what the report should cover.';
			return;
		}
		requesting = true;
		message = null;
		return async ({ result }) => {
			requesting = false;
			if (result.type === 'success') {
				const payload = result.data as { generate?: { outline?: Outline; outlineHash?: string } };
				if (payload.generate?.outline && payload.generate.outlineHash) {
					outline = payload.generate.outline;
					outlineHash = payload.generate.outlineHash;
					stage = 'review';
				}
			} else if (result.type === 'failure') {
				const payload = result.data as { generate?: { message?: string } };
				message = payload.generate?.message ?? 'Outline generation failed.';
			} else if (result.type === 'error') {
				message = 'Outline generation failed: the server could not be reached.';
			}
		};
	};

	// Editing the outline invalidates the prior approval: clear the hash so the
	// author must re-request (the only way to obtain a server-minted hash for the
	// current outline). A fill posted without a matching hash is refused server-side.
	function onOutlineEdit(): void {
		outlineHash = '';
		message = 'The outline changed - re-request to approve the new version.';
	}

	const submitFill: SubmitFunction = ({ formData, cancel }) => {
		if (!outline || !outlineHash) {
			cancel();
			message = 'Re-request the outline to approve it before generating content.';
			return;
		}
		formData.set('outline', JSON.stringify(outline));
		formData.set('outlineHash', outlineHash);
		formData.set('skeletonId', skeletonId);
		formData.set('dataSetId', dataSetId);
		filling = true;
		message = null;
		return async ({ result }) => {
			filling = false;
			if (result.type === 'success') {
				stage = 'done';
				message = 'Report generated. The editor now shows the filled draft.';
				// Reload the editor so it renders the freshly written document.
				await invalidateAll();
			} else if (result.type === 'failure') {
				const payload = result.data as { generate?: { message?: string } };
				message = payload.generate?.message ?? 'Content generation failed.';
			} else if (result.type === 'error') {
				message = 'Content generation failed: the server could not be reached.';
			}
		};
	};

	function reset(): void {
		outline = null;
		outlineHash = '';
		stage = 'request';
		message = null;
	}
</script>

<section class="generate" aria-label="Generate with AI">
	<h2>Generate with AI</h2>

	{#if disabled}
		<p class="note">Generation is available on draft reports. Unpublish to regenerate.</p>
	{:else if stage === 'request'}
		<form method="POST" action="?/generate-outline" use:enhance={submitOutline}>
			<label class="field">
				<span>What should the report cover?</span>
				<textarea
					name="intent"
					rows="3"
					bind:value={intent}
					placeholder="e.g. A weekly operations review of incident counts and resolution times."
				></textarea>
			</label>

			<label class="field">
				<span>Skeleton (optional)</span>
				<select name="skeletonId" bind:value={skeletonId}>
					<option value="">No skeleton</option>
					{#each skeletons as skeleton (skeleton.id)}
						<option value={skeleton.id}>{skeleton.name}</option>
					{/each}
				</select>
			</label>

			<label class="field">
				<span>Data set (optional)</span>
				<select name="dataSetId" bind:value={dataSetId}>
					<option value="">No data set</option>
					{#each dataSets as dataSet (dataSet.id)}
						<option value={dataSet.id}>{dataSet.filename}</option>
					{/each}
				</select>
			</label>

			<Button type="submit" variant="primary" disabled={requesting}>
				{requesting ? 'Requesting outline...' : 'Request outline'}
			</Button>
		</form>
	{:else if stage === 'review' && outline}
		<p class="note">Review the proposed outline, edit any line, then approve to fill the draft.</p>

		<label class="field">
			<span>Report title</span>
			<input
				value={outline.title}
				oninput={(event) => {
					if (outline) outline.title = event.currentTarget.value;
					onOutlineEdit();
				}}
			/>
		</label>

		{#each outline.sections as section, sectionIndex (sectionIndex)}
			<div class="outline-section">
				<input
					class="section-title"
					value={section.title}
					aria-label="Section title"
					oninput={(event) => {
						section.title = event.currentTarget.value;
						onOutlineEdit();
					}}
				/>
				<ul>
					{#each section.blocks as block, blockIndex (blockIndex)}
						<li>
							<span class="block-type">{block.type}</span>
							<input
								value={block.intent}
								aria-label="Block intent"
								oninput={(event) => {
									block.intent = event.currentTarget.value;
									onOutlineEdit();
								}}
							/>
						</li>
					{/each}
				</ul>
			</div>
		{/each}

		<div class="actions">
			<form method="POST" action="?/generate-fill" use:enhance={submitFill}>
				<Button type="submit" variant="primary" disabled={filling || !outlineHash}>
					{filling ? 'Generating content...' : 'Approve outline & generate'}
				</Button>
			</form>
			<Button variant="secondary" onclick={reset} disabled={filling}>Start over</Button>
		</div>
	{:else if stage === 'done'}
		<p class="note">{message}</p>
		<Button variant="secondary" onclick={reset}>Generate again</Button>
	{/if}

	{#if message && stage !== 'done'}
		<p class="problem" role="alert">{message}</p>
	{/if}
</section>

<style>
	.generate {
		max-width: 880px;
		margin-top: var(--space-6);
		padding: var(--space-4);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
	}

	h2 {
		margin: 0 0 var(--space-3);
		font-size: var(--text-lg);
	}

	.field {
		display: block;
		margin-bottom: var(--space-3);
	}

	.field span {
		display: block;
		margin-bottom: var(--space-1);
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}

	textarea,
	select,
	input {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		color: inherit;
		background: var(--color-stone);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.outline-section {
		margin-bottom: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	.section-title {
		font-weight: 600;
	}

	ul {
		margin: var(--space-2) 0 0;
		padding-left: var(--space-4);
	}

	li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.block-type {
		flex: none;
		padding: 0 var(--space-2);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-purple);
		text-transform: uppercase;
	}

	.actions {
		display: flex;
		gap: var(--space-3);
		align-items: center;
	}

	.note {
		margin: 0 0 var(--space-3);
		color: var(--color-ink-65);
		font-size: var(--text-sm);
	}

	.problem {
		margin-top: var(--space-3);
		padding: var(--space-3) var(--space-4);
		color: var(--color-danger);
		background: var(--color-danger-08);
		border-radius: var(--radius-sm);
	}
</style>
