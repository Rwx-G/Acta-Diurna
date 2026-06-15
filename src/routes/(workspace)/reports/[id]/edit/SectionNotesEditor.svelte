<script lang="ts">
	// Author-private section speaker notes (Story 6.2, edited in the WYSIWYG editor
	// per Story 10.6). Notes are an AUTHOR-ONLY affordance: they live on the working
	// copy and persist through the same validate-on-write save path every other edit
	// uses, but they are NEVER part of the reader-facing render. The reader-serving
	// chokepoint (`stripSpeakerNotes` at `getPublishedDocument`) drops them before a
	// document leaves the server, and the renderer never reads the field - so this
	// editor cannot make notes reader-visible. The hint below states that contract to
	// the author. Like every optional field, an empty value is omitted (undefined),
	// not stored as "" (the document format rule).
	interface Props {
		notes?: string;
		onEdit: () => void;
	}

	let { notes = $bindable(), onEdit }: Props = $props();

	const stateLabel = $derived(notes && notes.length > 0 ? 'present' : 'none');

	// Takes the textarea's current string (not the Event), so name it for the value
	// it commits rather than the `on*`-prefixed handler shape.
	function commitValue(value: string): void {
		notes = value === '' ? undefined : value;
		onEdit();
	}
</script>

<details class="notes">
	<summary>
		<span class="legend">Speaker notes:</span>
		<span class="state">{stateLabel}</span>
		<!-- The author-only contract is surfaced on the COLLAPSED disclosure, not only
		     inside the open body, so the privacy guarantee is visible without expanding. -->
		<span class="author-only-badge">Author-only</span>
	</summary>
	<div class="body">
		<textarea
			class="notes-input"
			rows="3"
			maxlength="20000"
			aria-label="Speaker notes"
			placeholder="Author-only notes for the presenter view"
			value={notes ?? ''}
			oninput={(event) => commitValue(event.currentTarget.value)}
		></textarea>
		<p class="privacy-hint">Author-only. Readers never see speaker notes.</p>
	</div>
</details>

<style>
	.notes {
		margin: 0 0 var(--space-3);
		padding: var(--space-1) var(--space-3);
		border: 1px dashed var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--color-ink-65);
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary::before {
		content: '\25B8';
		font-size: var(--text-xs);
		color: var(--color-ink-65);
	}

	.notes[open] summary::before {
		content: '\25BE';
	}

	.legend {
		font-weight: 600;
	}

	.state {
		text-transform: capitalize;
	}

	.author-only-badge {
		margin-left: auto;
		padding: 0 var(--space-2);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--color-ink-65);
		background: var(--color-stone);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-pill);
	}

	.body {
		margin-top: var(--space-2);
	}

	.notes-input {
		display: block;
		width: 100%;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-size: var(--text-sm);
		color: var(--color-ink);
		background: var(--color-stone);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
		resize: vertical;
	}

	.privacy-hint {
		margin: var(--space-1) 0 0;
		font-size: var(--text-xs);
		color: var(--color-ink-65);
	}
</style>
