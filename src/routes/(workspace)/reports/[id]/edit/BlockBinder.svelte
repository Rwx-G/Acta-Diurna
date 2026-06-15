<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { BindingSlot, DocumentV1 } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import type { BindActionResult, BindingGuard } from './editor-types';
	import type { PageData } from './$types';

	type DataSet = PageData['dataSets'][number];
	type BindableBlock = { id: string; type: 'table' | 'chart' | 'kpi'; label: string };

	interface Props {
		blocks: BindableBlock[];
		dataSets: DataSet[];
		disabled: boolean;
		/**
		 * Reports a successful bind UP to the editor (Epic 10.5): the re-resolved
		 * document + its new `updatedAt`, so the editor reseeds its working copy and
		 * advances the concurrency token instead of an invalidateAll that would clobber
		 * in-flight edits and leave the token stale.
		 */
		onBound: (savedAt: string, document: DocumentV1) => void;
		/**
		 * The editor's dirty/saving guard (Epic 10.5): a bind reseeds the working copy
		 * from the server document, so it must not run while unsaved edits are in flight
		 * or it would overwrite them. Returns false (and cancels) to block the submit.
		 */
		bindingGuard: BindingGuard;
	}

	let { blocks, dataSets, disabled, onBound, bindingGuard }: Props = $props();

	// Initial selection only; the selects below bind these and the lists are
	// stable for the editor's lifetime (a remount via {#key} resets them).
	// svelte-ignore state_referenced_locally
	let blockId = $state(blocks[0]?.id ?? '');
	// svelte-ignore state_referenced_locally
	let dataSetId = $state(dataSets[0]?.id ?? '');
	// fieldName -> slot role; '' means unmapped. The role set offered depends on
	// the chosen block type, so the author cannot pick a chart slot for a table.
	let roles = $state<Record<string, string>>({});
	let binding = $state(false);
	let message = $state<string | null>(null);
	let messageVariant = $state<'ok' | 'error'>('ok');

	const selectedBlock = $derived(blocks.find((block) => block.id === blockId));
	const selectedDataSet = $derived(dataSets.find((set) => set.id === dataSetId));

	const ROLE_OPTIONS: Record<BindableBlock['type'], { value: string; label: string }[]> = {
		table: [{ value: 'column', label: 'Column' }],
		chart: [
			{ value: 'x', label: 'X axis' },
			{ value: 'y', label: 'Y series' }
		],
		kpi: [
			{ value: 'value', label: 'Value' },
			{ value: 'label', label: 'Label' }
		]
	};

	const roleOptions = $derived(selectedBlock ? ROLE_OPTIONS[selectedBlock.type] : []);

	function slotMappingJson(): string {
		const mapping: Record<string, BindingSlot> = {};
		for (const [name, role] of Object.entries(roles)) {
			if (role) mapping[name] = { role: role as BindingSlot['role'] };
		}
		return JSON.stringify(mapping);
	}

	const submitBind: SubmitFunction = ({ formData, cancel }) => {
		if (!selectedBlock || !selectedDataSet) {
			cancel();
			return;
		}
		// Block the bind while the editor has unsaved edits in flight (the DATA-LOSS
		// guard): a bind reseed would overwrite them. Let the autosave land, then retry.
		if (!bindingGuard(cancel)) return;
		formData.set('blockId', blockId);
		formData.set('dataSetId', dataSetId);
		formData.set('slotMapping', slotMappingJson());
		binding = true;
		message = null;
		return async ({ result }) => {
			binding = false;
			if (result.type === 'success') {
				message = 'Block bound to the data set.';
				messageVariant = 'ok';
				const payload = result.data as Partial<BindActionResult> | undefined;
				if (payload?.boundAt && payload.document) {
					onBound(payload.boundAt, payload.document);
				}
			} else if (result.type === 'failure') {
				const payload = result.data as { message?: string } | undefined;
				message = payload?.message ?? 'Bind failed.';
				messageVariant = 'error';
			} else if (result.type === 'error') {
				message = 'Bind failed: the server could not be reached.';
				messageVariant = 'error';
			}
		};
	};
</script>

<section class="binder" aria-label="Bind data">
	<h2>Bind data</h2>
	{#if blocks.length === 0}
		<p class="hint">Add a table, chart, or KPI block to bind uploaded data.</p>
	{:else if dataSets.length === 0}
		<p class="hint">
			No data sets uploaded yet. Upload a CSV or JSON file from Data sets, then bind it here.
		</p>
	{:else}
		<form method="POST" action="?/bind" use:enhance={submitBind}>
			<fieldset disabled={disabled || binding}>
				<label>
					Block
					<select bind:value={blockId}>
						{#each blocks as block (block.id)}
							<option value={block.id}>{block.label}</option>
						{/each}
					</select>
				</label>

				<label>
					Data set
					<select bind:value={dataSetId}>
						{#each dataSets as set (set.id)}
							<option value={set.id}>{set.filename}</option>
						{/each}
					</select>
				</label>

				{#if selectedDataSet}
					<table class="mapping">
						<thead>
							<tr><th>Field</th><th>Type</th><th>Slot</th></tr>
						</thead>
						<tbody>
							{#each selectedDataSet.fields as field (field.name)}
								<tr>
									<td>{field.name}</td>
									<td><span class="type">{field.type}</span></td>
									<td>
										<select bind:value={roles[field.name]}>
											<option value="">Unbound</option>
											{#each roleOptions as option (option.value)}
												<option value={option.value}>{option.label}</option>
											{/each}
										</select>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}

				<Button type="submit" variant="primary" disabled={disabled || binding}>
					{binding ? 'Binding...' : 'Bind block'}
				</Button>
			</fieldset>
		</form>

		{#if message}
			<p class="message {messageVariant}" role="status">{message}</p>
		{/if}
	{/if}
</section>

<style>
	.binder {
		max-width: 880px;
		margin-top: var(--space-6);
		padding: var(--space-4);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	h2 {
		margin-top: 0;
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

	.mapping {
		width: 100%;
		border-collapse: collapse;
	}

	.mapping th,
	.mapping td {
		padding: var(--space-1) var(--space-2);
		text-align: left;
		border-bottom: 1px solid var(--color-ink-12);
		font-weight: 400;
	}

	.mapping th {
		font-size: 12px;
		color: var(--color-ink-65);
	}

	.type {
		font-size: 12px;
		padding: 0 var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-ink-65);
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
