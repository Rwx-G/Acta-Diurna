<script lang="ts">
	import type { DocumentV1, Scale, ScaleEntry } from '$lib/schema';
	import {
		MAX_SCALES,
		MAX_SCALE_ENTRIES,
		findEntryReferences,
		findScaleReferences,
		renameEntryKey,
		renameScaleKey,
		type ScaleReference
	} from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import UiIcon from '$lib/ui/UiIcon.svelte';
	import { moveItem } from './editor-state';

	// Document-level scales CRUD (the gap: scales were only writable via the whole-doc
	// PATCH, out of an in-browser author's reach). A scale and its entries are referenced
	// by KEY from blocks across the document, so a key rename here cascades through every
	// reference via the pure `renameScaleKey` / `renameEntryKey` transforms (which return
	// a fresh document); the parent reseeds `doc` from that result, exactly as a binding
	// reconcile does. label / colour / sublabel are free edits with no cascade. A scale or
	// entry still referenced cannot be deleted (it would dangle a block at validation), so
	// the delete guard names the referrers instead.
	interface Props {
		doc: DocumentV1;
		editable: boolean;
		onEdit: () => void;
	}

	let { doc = $bindable(), editable, onEdit }: Props = $props();

	const scales = $derived(doc.scales ?? []);

	let panelOpen = $state(false);
	// A single panel-level notice for a rejected action (an invalid/duplicate key, a
	// blocked delete). Cleared on the next successful edit so it never lingers stale.
	let notice = $state<string | null>(null);

	// Mirrors `idSchema` (slug: lowercase alphanumerics joined by single hyphens). The
	// key cascade and the server both reject anything else, so the field validates here
	// before a rename fires rather than letting the autosave 422.
	const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

	function validateKey(key: string, taken: string[]): string | null {
		if (!ID_PATTERN.test(key)) {
			return `"${key}" is not a valid key. Use lowercase letters, digits, and single hyphens (e.g. high-risk).`;
		}
		if (taken.includes(key)) return `The key "${key}" is already used. Keys must be unique.`;
		return null;
	}

	/** A key built off `base` that avoids every key in `taken` (base, base-2, base-3...). */
	function uniqueKey(base: string, taken: string[]): string {
		if (!taken.includes(base)) return base;
		let n = 2;
		while (taken.includes(`${base}-${n}`)) n += 1;
		return `${base}-${n}`;
	}

	function ensureScales(): Scale[] {
		if (!doc.scales) doc.scales = [];
		return doc.scales;
	}

	function describeRefs(refs: ScaleReference[]): string {
		const parts = refs.map((ref) => `${ref.blockType} (${ref.via})`);
		const unique = [...new Set(parts)];
		const shown = unique.slice(0, 4).join(', ');
		const rest = unique.length > 4 ? `, +${unique.length - 4} more` : '';
		return `${shown}${rest}`;
	}

	function addScale(): void {
		if (!editable) return;
		const list = ensureScales();
		if (list.length >= MAX_SCALES) {
			notice = `A document may declare at most ${MAX_SCALES} scales.`;
			return;
		}
		const key = uniqueKey(
			'scale',
			list.map((scale) => scale.key)
		);
		// Non-empty default labels: the schema requires a min-1 label on a scale and on
		// each entry, so a freshly-added scale must be VALID immediately or the document
		// fails validation and cannot autosave (the author renames the placeholders after).
		list.push({
			key,
			label: 'New scale',
			kind: 'ordinal',
			entries: [{ key: 'entry-1', label: 'Entry 1' }]
		});
		notice = null;
		onEdit();
	}

	function removeScale(index: number): void {
		if (!editable) return;
		const scale = scales[index];
		const refs = findScaleReferences($state.snapshot(doc) as DocumentV1, scale.key);
		if (refs.length > 0) {
			notice = `Cannot delete the "${scale.key}" scale: still referenced by ${describeRefs(refs)}. Remove or repoint those blocks first.`;
			return;
		}
		doc.scales?.splice(index, 1);
		notice = null;
		onEdit();
	}

	function moveScale(index: number, direction: -1 | 1): void {
		if (!editable || !doc.scales) return;
		moveItem(doc.scales, index, direction);
		notice = null;
		onEdit();
	}

	function commitScaleKey(index: number, event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const current = scales[index].key;
		const next = input.value.trim();
		if (next === current) {
			notice = null;
			return;
		}
		const taken = scales.filter((_, i) => i !== index).map((scale) => scale.key);
		const error = validateKey(next, taken);
		if (error) {
			notice = error;
			input.value = current;
			return;
		}
		notice = null;
		doc = renameScaleKey($state.snapshot(doc) as DocumentV1, current, next);
		onEdit();
	}

	function setScaleKind(index: number, value: string): void {
		const scale = scales[index];
		if (value === 'ordinal' || value === 'nominal') scale.kind = value;
		else delete scale.kind;
		onEdit();
	}

	function addEntry(scale: Scale): void {
		if (!editable) return;
		if (scale.entries.length >= MAX_SCALE_ENTRIES) {
			notice = `A scale may hold at most ${MAX_SCALE_ENTRIES} entries.`;
			return;
		}
		const key = uniqueKey(
			'entry',
			scale.entries.map((entry) => entry.key)
		);
		// A non-empty default label keeps the document valid (the schema requires min-1),
		// so adding an entry never blocks the autosave; the author renames it after.
		scale.entries.push({ key, label: 'New entry' });
		notice = null;
		onEdit();
	}

	function removeEntry(scaleIndex: number, entryIndex: number): void {
		if (!editable) return;
		const scale = scales[scaleIndex];
		if (scale.entries.length <= 1) {
			notice = `A scale needs at least one entry; rename or repoint "${scale.key}" instead of emptying it.`;
			return;
		}
		const entry = scale.entries[entryIndex];
		const refs = findEntryReferences($state.snapshot(doc) as DocumentV1, scale.key, entry.key);
		if (refs.length > 0) {
			notice = `Cannot delete the "${entry.key}" entry: still referenced by ${describeRefs(refs)}. Repoint those blocks first.`;
			return;
		}
		scale.entries.splice(entryIndex, 1);
		notice = null;
		onEdit();
	}

	function moveEntry(scale: Scale, index: number, direction: -1 | 1): void {
		if (!editable) return;
		moveItem(scale.entries, index, direction);
		notice = null;
		onEdit();
	}

	function commitEntryKey(scaleIndex: number, entryIndex: number, event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const scale = scales[scaleIndex];
		const current = scale.entries[entryIndex].key;
		const next = input.value.trim();
		if (next === current) {
			notice = null;
			return;
		}
		const taken = scale.entries.filter((_, i) => i !== entryIndex).map((entry) => entry.key);
		const error = validateKey(next, taken);
		if (error) {
			notice = error;
			input.value = current;
			return;
		}
		notice = null;
		doc = renameEntryKey($state.snapshot(doc) as DocumentV1, scale.key, current, next);
		onEdit();
	}

	function setColor(entry: ScaleEntry, value: string): void {
		entry.color = value;
		onEdit();
	}

	function clearColor(entry: ScaleEntry): void {
		delete entry.color;
		onEdit();
	}
</script>

<section class="scales-panel">
	<details bind:open={panelOpen}>
		<summary class="panel-summary">
			<span class="panel-caret" aria-hidden="true"><UiIcon name="chevron-down" /></span>
			<span class="panel-title">Scales</span>
			<span class="panel-count">{scales.length}</span>
		</summary>

		<div class="panel-body">
			{#if notice}
				<p class="notice" role="alert">{notice}</p>
			{/if}

			{#if scales.length === 0}
				<p class="empty">
					No scales yet. A scale defines a shared set of categories (severity levels, audit sources)
					that legend, comparison-matrix, chip-cluster, table and timeline blocks reference by key.
				</p>
			{/if}

			{#each scales as scale, scaleIndex (scale.key)}
				<details class="scale-card">
					<summary class="scale-summary">
						<span class="scale-caret" aria-hidden="true"><UiIcon name="chevron-down" /></span>
						<span class="scale-key-chip">{scale.key}</span>
						<span class="scale-kind">{scale.kind ?? 'no kind'}</span>
						<span class="scale-entry-count"
							>{scale.entries.length}
							{scale.entries.length === 1 ? 'entry' : 'entries'}</span
						>
						{#if scale.label}<span class="scale-label-preview">{scale.label}</span>{/if}
					</summary>

					<div class="scale-body">
						<div class="scale-controls">
							<Button
								class="row-control"
								variant="icon"
								onclick={() => moveScale(scaleIndex, -1)}
								disabled={!editable || scaleIndex === 0}
								aria-label="Move scale up"
							>
								<UiIcon name="chevron-up" />
							</Button>
							<Button
								class="row-control"
								variant="icon"
								onclick={() => moveScale(scaleIndex, 1)}
								disabled={!editable || scaleIndex === scales.length - 1}
								aria-label="Move scale down"
							>
								<UiIcon name="chevron-down" />
							</Button>
							<Button
								class="row-control"
								variant="icon-danger"
								onclick={() => removeScale(scaleIndex)}
								disabled={!editable}
								aria-label="Delete scale"
							>
								<UiIcon name="trash" />
							</Button>
						</div>

						<div class="scale-fields">
							<label class="field">
								<span class="field-label">Key</span>
								<input
									value={scale.key}
									disabled={!editable}
									onchange={(event) => commitScaleKey(scaleIndex, event)}
									aria-label={`Scale ${scaleIndex + 1} key`}
								/>
							</label>
							<label class="field">
								<span class="field-label">Label</span>
								<input
									value={scale.label}
									disabled={!editable}
									oninput={(event) => {
										scale.label = event.currentTarget.value;
										onEdit();
									}}
									aria-label={`Scale ${scaleIndex + 1} label`}
								/>
							</label>
							<label class="field field-kind">
								<span class="field-label">Kind</span>
								<select
									value={scale.kind ?? ''}
									disabled={!editable}
									onchange={(event) => setScaleKind(scaleIndex, event.currentTarget.value)}
									aria-label={`Scale ${scaleIndex + 1} kind`}
								>
									<option value="ordinal">Ordinal (ranked)</option>
									<option value="nominal">Nominal (unordered)</option>
									<option value="">No kind</option>
								</select>
							</label>
						</div>

						<div class="entries">
							<span class="entries-label">Entries</span>
							{#each scale.entries as entry, entryIndex (entry.key)}
								<div class="entry-row">
									<label class="field field-key">
										<span class="field-label">Key</span>
										<input
											value={entry.key}
											disabled={!editable}
											onchange={(event) => commitEntryKey(scaleIndex, entryIndex, event)}
											aria-label={`Entry ${entryIndex + 1} key`}
										/>
									</label>
									<label class="field">
										<span class="field-label">Label</span>
										<input
											value={entry.label}
											disabled={!editable}
											oninput={(event) => {
												entry.label = event.currentTarget.value;
												onEdit();
											}}
											aria-label={`Entry ${entryIndex + 1} label`}
										/>
									</label>
									<div class="field field-color">
										<span class="field-label">Colour</span>
										<div class="color-control">
											<input
												type="color"
												class:auto={entry.color === undefined}
												value={entry.color ?? '#888888'}
												disabled={!editable}
												oninput={(event) => setColor(entry, event.currentTarget.value)}
												aria-label={`Entry ${entryIndex + 1} colour`}
											/>
											{#if entry.color === undefined}
												<span class="auto-badge">auto</span>
											{:else}
												<Button
													class="row-control"
													variant="icon-danger"
													onclick={() => clearColor(entry)}
													disabled={!editable}
													aria-label={`Clear entry ${entryIndex + 1} colour`}
												>
													<UiIcon name="x" />
												</Button>
											{/if}
										</div>
									</div>
									<label class="field">
										<span class="field-label">Sublabel</span>
										<input
											value={entry.sublabel ?? ''}
											disabled={!editable}
											oninput={(event) => {
												const value = event.currentTarget.value;
												if (value === '') delete entry.sublabel;
												else entry.sublabel = value;
												onEdit();
											}}
											aria-label={`Entry ${entryIndex + 1} sublabel`}
										/>
									</label>
									<div class="entry-controls">
										<Button
											class="row-control"
											variant="icon"
											onclick={() => moveEntry(scale, entryIndex, -1)}
											disabled={!editable || entryIndex === 0}
											aria-label={`Move entry ${entryIndex + 1} up`}
										>
											<UiIcon name="chevron-up" />
										</Button>
										<Button
											class="row-control"
											variant="icon"
											onclick={() => moveEntry(scale, entryIndex, 1)}
											disabled={!editable || entryIndex === scale.entries.length - 1}
											aria-label={`Move entry ${entryIndex + 1} down`}
										>
											<UiIcon name="chevron-down" />
										</Button>
										<Button
											class="row-control"
											variant="icon-danger"
											onclick={() => removeEntry(scaleIndex, entryIndex)}
											disabled={!editable}
											aria-label={`Delete entry ${entryIndex + 1}`}
										>
											<UiIcon name="trash" />
										</Button>
									</div>
								</div>
							{/each}

							<Button
								variant="ghost"
								onclick={() => addEntry(scale)}
								disabled={!editable || scale.entries.length >= MAX_SCALE_ENTRIES}
							>
								<UiIcon name="plus" />
								Add entry
							</Button>
						</div>
					</div>
				</details>
			{/each}

			<div class="add-scale">
				<Button
					variant="secondary"
					onclick={addScale}
					disabled={!editable || scales.length >= MAX_SCALES}
				>
					<UiIcon name="plus" />
					Add scale
				</Button>
			</div>
		</div>
	</details>
</section>

<style>
	.scales-panel {
		margin-bottom: var(--space-5);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-md);
	}

	.panel-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		font-weight: 600;
		cursor: pointer;
		list-style: none;
	}

	.panel-summary::-webkit-details-marker {
		display: none;
	}

	/* The caret rotates from pointing-right (closed) to pointing-down (open); the
	   chevron-down glyph is rotated -90deg at rest and back to 0 when the panel opens. */
	.panel-caret,
	.scale-caret {
		display: inline-flex;
		align-items: center;
		color: var(--color-ink-65);
		font-size: 18px;
		transform: rotate(-90deg);
		transition: transform 0.12s ease;
	}

	details[open] > .panel-summary > .panel-caret,
	details[open] > .scale-summary > .scale-caret {
		transform: rotate(0deg);
	}

	.panel-title {
		font-size: var(--text-base);
	}

	.panel-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.4rem;
		padding: 0 var(--space-2);
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--color-ink-65);
		background: var(--color-ink-08);
		border-radius: var(--radius-pill);
	}

	.panel-body {
		padding: 0 var(--space-4) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.notice {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-sm);
		color: var(--color-danger);
		background: var(--color-danger-08);
		border-radius: var(--radius-sm);
	}

	.empty {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}

	.scale-card {
		background: var(--color-stone);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	.scale-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
		list-style: none;
		flex-wrap: wrap;
	}

	.scale-summary::-webkit-details-marker {
		display: none;
	}

	.scale-key-chip {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink);
	}

	.scale-kind,
	.scale-entry-count {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-ink-65);
		background: var(--color-ink-08);
		padding: 1px var(--space-2);
		border-radius: var(--radius-pill);
	}

	.scale-label-preview {
		font-size: var(--text-sm);
		color: var(--color-ink-65);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.scale-body {
		padding: 0 var(--space-3) var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.scale-controls,
	.entry-controls {
		display: flex;
		gap: var(--space-1);
	}

	.scale-fields {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		flex: 1 1 10rem;
		min-width: 0;
	}

	.field-kind,
	.field-key {
		flex: 0 1 9rem;
	}

	.field-label {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-ink-65);
	}

	.field input,
	.field select {
		min-width: 0;
		padding: var(--space-1) var(--space-2);
		font: inherit;
		font-size: var(--text-sm);
		color: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.field-key input {
		font-family: var(--font-mono);
	}

	.entries {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-ink-12);
	}

	.entries-label {
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-ink-65);
	}

	.entry-row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-2);
		padding: var(--space-2);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	.field-color {
		flex: 0 0 auto;
	}

	.color-control {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.color-control input[type='color'] {
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
		background: none;
		cursor: pointer;
	}

	/* When no explicit colour is set the swatch is desaturated, paired with the "auto"
	   badge, so the author reads "this falls back to the palette" rather than mistaking
	   the placeholder grey for a chosen colour. */
	.color-control input[type='color'].auto {
		opacity: 0.45;
	}

	.auto-badge {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--color-ink-65);
	}

	.add-scale {
		margin-top: var(--space-1);
	}
</style>
