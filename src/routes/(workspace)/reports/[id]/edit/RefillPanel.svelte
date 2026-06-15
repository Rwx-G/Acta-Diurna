<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { BindingSummary as Summary, BlockDiagnostic } from '$lib/server/ingestion';
	import type { DocumentV1 } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import BindingChip from '$lib/ui/BindingChip.svelte';
	import BindingSummaryView from '$lib/ui/BindingSummary.svelte';
	import DiagnosticPanel from '$lib/ui/DiagnosticPanel.svelte';
	import type { PageData } from './$types';

	// The refill (UX Flow B), story 2.5: pick a fresh data set, rebind every
	// matching bound block in one action (FR14), glance at the all-green summary,
	// and remap any drift in place (FR15). Diagnostics come back from the rebind
	// action; the chips and panels drive off them. Workspace-only and outside the
	// reader closure (lib/ui chips never enter the render tier).
	//
	// Epic 10.5: the rebind / remap results are reported UP to the editor (onRebound
	// / onRemapped) so it reseeds its working copy and advances the concurrency token
	// (reconcileBinding), instead of an invalidateAll that would clobber in-flight
	// edits and leave the token stale - the same reconciliation BlockBinder uses.
	type DataSet = PageData['dataSets'][number];

	interface Props {
		dataSets: DataSet[];
		disabled: boolean;
		onRebound: (
			savedAt: string,
			document: DocumentV1,
			diagnostics: BlockDiagnostic[],
			dataSetId: string
		) => void;
		onRemapped: (savedAt: string, document: DocumentV1, blockId: string) => void;
	}

	let { dataSets, disabled, onRebound, onRemapped }: Props = $props();

	// svelte-ignore state_referenced_locally
	let dataSetId = $state(dataSets[0]?.id ?? '');
	let rebinding = $state(false);
	let diagnostics = $state<BlockDiagnostic[]>([]);
	let summary = $state<Summary | null>(null);
	let rebound = $state<string[]>([]);
	let message = $state<string | null>(null);
	let messageVariant = $state<'ok' | 'error'>('ok');
	let openBlockId = $state<string | null>(null);

	const selectedDataSet = $derived(dataSets.find((set) => set.id === dataSetId));
	const availableFields = $derived(selectedDataSet?.fields.map((field) => field.name) ?? []);
	const driftedDiagnostics = $derived(diagnostics.filter((d) => d.state !== 'bound'));

	const submitRebind: SubmitFunction = ({ formData }) => {
		formData.set('dataSetId', dataSetId);
		rebinding = true;
		message = null;
		return async ({ result }) => {
			rebinding = false;
			if (result.type === 'success') {
				const payload = result.data as {
					reboundAt?: string;
					document?: DocumentV1;
					diagnostics?: BlockDiagnostic[];
					summary?: Summary;
					rebound?: string[];
				};
				diagnostics = payload.diagnostics ?? [];
				summary = payload.summary ?? null;
				rebound = payload.rebound ?? [];
				message =
					summary && summary.total === 0
						? 'No bound blocks to refill.'
						: summary && summary.allGreen
							? `Rebound ${rebound.length} block(s) - all green.`
							: `Rebound ${rebound.length} block(s); some bindings need a remap.`;
				messageVariant = 'ok';
				if (payload.reboundAt && payload.document) {
					onRebound(payload.reboundAt, payload.document, diagnostics, dataSetId);
				}
			} else if (result.type === 'failure') {
				const payload = result.data as { message?: string } | undefined;
				message = payload?.message ?? 'Rebind failed.';
				messageVariant = 'error';
			} else if (result.type === 'error') {
				message = 'Rebind failed: the server could not be reached.';
				messageVariant = 'error';
			}
		};
	};

	const submitRemap: SubmitFunction = ({ formData }) => {
		const remappedBlockId = String(formData.get('blockId') ?? '');
		return async ({ result }) => {
			if (result.type === 'success') {
				message = 'Field remapped and re-resolved.';
				messageVariant = 'ok';
				openBlockId = null;
				// Drop the now-green block from the panel's local diagnostics too, so its
				// amber chip clears here (the editor clears the block-level one via onRemapped).
				diagnostics = diagnostics.filter((d) => d.blockId !== remappedBlockId);
				const payload = result.data as { remappedAt?: string; document?: DocumentV1 } | undefined;
				if (payload?.remappedAt && payload.document) {
					onRemapped(payload.remappedAt, payload.document, remappedBlockId);
				}
			} else if (result.type === 'failure') {
				const payload = result.data as { message?: string } | undefined;
				message = payload?.message ?? 'Remap failed.';
				messageVariant = 'error';
			} else if (result.type === 'error') {
				message = 'Remap failed: the server could not be reached.';
				messageVariant = 'error';
			}
		};
	};
</script>

<section class="refill" aria-label="Refill data">
	<div class="head">
		<h2>Refill</h2>
		{#if summary}<BindingSummaryView {summary} />{/if}
	</div>

	{#if dataSets.length === 0}
		<p class="hint">
			No data sets uploaded yet. Upload a fresh CSV or JSON export from Data sets, then rebind here.
		</p>
	{:else}
		<form method="POST" action="?/rebind" use:enhance={submitRebind}>
			<fieldset disabled={disabled || rebinding}>
				<label>
					Fresh data set
					<select bind:value={dataSetId}>
						{#each dataSets as set (set.id)}
							<option value={set.id}>{set.filename}</option>
						{/each}
					</select>
				</label>
				<Button type="submit" variant="primary" disabled={disabled || rebinding}>
					{rebinding ? 'Rebinding...' : 'Rebind from this data set'}
				</Button>
			</fieldset>
		</form>

		{#if diagnostics.length > 0}
			<ul class="chips" aria-label="Block binding states">
				{#each diagnostics as diagnostic (diagnostic.blockId)}
					<li>
						<span class="chip-label">{diagnostic.label}</span>
						{#if diagnostic.state === 'bound'}
							<BindingChip state="bound" />
						{:else}
							<BindingChip
								state={diagnostic.state}
								count={diagnostic.drifts.length}
								pressed={openBlockId === diagnostic.blockId}
								onclick={() =>
									(openBlockId = openBlockId === diagnostic.blockId ? null : diagnostic.blockId)}
							/>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#each driftedDiagnostics as diagnostic (diagnostic.blockId)}
			{#if openBlockId === diagnostic.blockId}
				<DiagnosticPanel {diagnostic} available={availableFields}>
					{#snippet remap(expectedField: string, suggested: string | null)}
						<form method="POST" action="?/remap" use:enhance={submitRemap} class="remap">
							<input type="hidden" name="blockId" value={diagnostic.blockId} />
							<input type="hidden" name="dataSetId" value={dataSetId} />
							<input type="hidden" name="expectedField" value={expectedField} />
							<label class="remap-pick">
								Map to
								<select
									name="availableField"
									value={suggested ?? ''}
									disabled={availableFields.length === 0}
								>
									{#each availableFields as name (name)}
										<option value={name}>{name}</option>
									{/each}
								</select>
							</label>
							<Button
								type="submit"
								variant="secondary"
								disabled={disabled || availableFields.length === 0}
							>
								Remap
							</Button>
						</form>
					{/snippet}
				</DiagnosticPanel>
			{/if}
		{/each}
	{/if}

	{#if message}
		<p class="message {messageVariant}" role="status">{message}</p>
	{/if}
</section>

<style>
	.refill {
		max-width: 880px;
		margin-top: var(--space-6);
		padding: var(--space-4);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-3);
	}

	h2 {
		margin: 0;
		font-size: var(--text-md);
	}

	.hint {
		color: var(--color-ink-65);
	}

	fieldset {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		border: 0;
	}

	label {
		display: grid;
		gap: var(--space-1);
		font-size: var(--text-sm);
		font-weight: 600;
	}

	select {
		font: inherit;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.chips {
		display: grid;
		gap: var(--space-2);
		margin: var(--space-4) 0 0;
		padding: 0;
		list-style: none;
	}

	.chips li {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.chip-label {
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}

	.remap {
		display: flex;
		align-items: end;
		gap: var(--space-2);
		margin: 0;
	}

	.remap-pick {
		font-size: 12px;
	}

	.message {
		margin-top: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-sm);
	}

	.message.ok {
		background: var(--color-purple-08);
	}

	.message.error {
		color: var(--color-danger);
		background: var(--color-danger-08);
	}
</style>
