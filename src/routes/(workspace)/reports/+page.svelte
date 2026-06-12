<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { formatUtcDateTime } from '$lib/format';
	import Button from '$lib/ui/Button.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import PageHeader from '$lib/ui/PageHeader.svelte';
	import StatusChip from '$lib/ui/StatusChip.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let confirmingId = $state<string | null>(null);
	let confirmTimer: ReturnType<typeof setTimeout> | undefined;

	// UX destructive pattern: first click swaps the button to "Confirm
	// delete?" for 5 s, second click submits. Without JS the form submits
	// directly (drafts only; published reports refuse server-side with 409).
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

	const newReportPath = resolve('/(workspace)/reports/new');
</script>

<svelte:head>
	<title>Reports - Acta Diurna</title>
</svelte:head>

{#snippet newReportAction()}
	<form method="POST" action={newReportPath}>
		<Button variant="primary" type="submit">New report</Button>
	</form>
{/snippet}

<PageHeader
	title="Reports"
	lede="Create, edit, and publish your reports."
	action={data.reports.length > 0 ? newReportAction : undefined}
/>

{#if form?.message}
	<p class="problem" role="alert">{form.message}</p>
{/if}

{#if data.reports.length === 0}
	<EmptyState
		title="No reports yet - create your first"
		description="A report starts as a draft you edit section by section."
	>
		<form method="POST" action={newReportPath}>
			<Button variant="primary" type="submit">Create your first report</Button>
		</form>
	</EmptyState>
{:else}
	<ul class="report-list">
		{#each data.reports as report (report.id)}
			<li>
				<a href={resolve('/(workspace)/reports/[id]/edit', { id: report.id })} class="title">
					{report.title}
				</a>
				<StatusChip status={report.status} />
				<span class="updated">Updated {formatUtcDateTime(report.updatedAt)}</span>
				<form method="POST" action="?/duplicate" use:enhance>
					<input type="hidden" name="id" value={report.id} />
					<Button variant="secondary" type="submit">Duplicate</Button>
				</form>
				{#if report.status === 'published'}
					<a
						href={resolve('/(workspace)/reports/[id]/share', { id: report.id })}
						class="action-link"
					>
						Share
					</a>
				{/if}
				{#if report.status === 'draft'}
					<form method="POST" action="?/delete" use:enhance={confirmDelete}>
						<input type="hidden" name="id" value={report.id} />
						<Button variant="danger" type="submit">
							{confirmingId === report.id ? 'Confirm delete?' : 'Delete'}
						</Button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.problem {
		max-width: var(--content-width);
		margin: 0 auto var(--space-4);
		padding: var(--space-3) var(--space-4);
		color: var(--color-danger);
		background: var(--color-danger-08);
		border-radius: var(--radius-sm);
	}

	.report-list {
		max-width: var(--content-width);
		margin: 0 auto;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
	}

	.report-list li {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
		margin-bottom: var(--space-2);
	}

	.title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
		color: var(--color-ink);
		text-decoration: none;
	}

	.title:hover {
		color: var(--color-purple);
	}

	.updated {
		color: var(--color-ink-65);
		font-size: 12px;
	}

	.action-link {
		padding: var(--space-2) var(--space-4);
		font-weight: 600;
		color: var(--color-ink);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
		text-decoration: none;
	}

	.action-link:hover {
		border-color: var(--color-purple);
		color: var(--color-purple);
	}
</style>
