<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { formatUtcDateTime } from '$lib/format';
	import Button from '$lib/ui/Button.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let confirmingId = $state<string | null>(null);
	let confirmTimer: ReturnType<typeof setTimeout> | undefined;

	// Same destructive pattern as the reports list: first click swaps the button
	// to "Confirm delete?" for 5 s, second click submits.
	const confirmDelete: SubmitFunction = ({ formData, cancel }) => {
		const id = String(formData.get('id'));
		if (confirmingId !== id) {
			cancel();
			confirmingId = id;
			clearTimeout(confirmTimer);
			confirmTimer = setTimeout(() => (confirmingId = null), 5000);
			return;
		}
		clearTimeout(confirmTimer);
		confirmingId = null;
		return async ({ update }) => {
			await update();
		};
	};

	const composePath = resolve('/(workspace)/skeletons/compose');
</script>

<svelte:head>
	<title>Skeletons - Acta Diurna</title>
</svelte:head>

<div class="page-header">
	<h1>Skeletons</h1>
	{#if data.skeletons.length > 0}
		<a href={composePath} class="cta">New skeleton</a>
	{/if}
</div>

{#if form?.message}
	<p class="problem" role="alert">{form.message}</p>
{/if}

{#if data.skeletons.length === 0}
	<EmptyState
		title="No skeletons yet - compose your first"
		description="A skeleton is a reusable report structure. Every report created from it shares the same sections, blocks, and bindings."
	>
		<a href={composePath} class="cta">Compose your first skeleton</a>
	</EmptyState>
{:else}
	<ul class="skeleton-list">
		{#each data.skeletons as skeleton (skeleton.id)}
			<li>
				<span class="name">{skeleton.name}</span>
				<span class="updated">Updated {formatUtcDateTime(skeleton.updatedAt)}</span>
				<form method="POST" action="?/instantiate">
					<input type="hidden" name="id" value={skeleton.id} />
					<Button variant="primary" type="submit">Create report</Button>
				</form>
				<form method="POST" action="?/delete" use:enhance={confirmDelete}>
					<input type="hidden" name="id" value={skeleton.id} />
					<Button variant="danger" type="submit">
						{confirmingId === skeleton.id ? 'Confirm delete?' : 'Delete'}
					</Button>
				</form>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-5);
	}

	h1 {
		margin: 0;
		font-size: 20px;
	}

	/* Anchor styled as the primary CTA: navigation, not a form submit, so it must
	   stay an <a> (no button-in-link nesting). */
	.cta {
		padding: var(--space-2) var(--space-4);
		font-weight: 600;
		color: var(--color-stone);
		background: var(--color-purple);
		border: 1px solid var(--color-purple);
		border-radius: var(--radius-sm);
		text-decoration: none;
	}

	.cta:hover {
		background: color-mix(in srgb, var(--color-purple) 88%, var(--color-ink));
	}

	.problem {
		padding: var(--space-3) var(--space-4);
		color: var(--color-danger);
		background: var(--color-danger-08);
		border-radius: var(--radius-sm);
	}

	.skeleton-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
	}

	.skeleton-list li {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
		margin-bottom: var(--space-2);
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
		color: var(--color-ink);
	}

	.updated {
		color: var(--color-ink-65);
		font-size: 12px;
	}
</style>
