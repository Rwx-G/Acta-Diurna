<script lang="ts">
	import type { Paragraph } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import { moveItem, newRun, RUN_MARKS, setRunLink, toggleRunMark } from './editor-state';

	// Shared inline-run paragraph editor (Story 10.4). A run-bearing block edits its
	// rich text as an ordered list of paragraphs, each an ordered list of RUNS; a run
	// is a span of text plus the marks the SCHEMA defines (`inlineRunSchema`: bold /
	// italic / inline-code, and an http(s) `link`). This is the SAME run-level
	// affordance the text block (Story 10.3) introduced, extracted so the callout
	// body, the list-item description and the timeline-milestone detail share one
	// editor instead of the 1.5 flatten-on-edit textarea that discarded every mark.
	//
	// It writes ONLY those marks - there is no contenteditable and no HTML path - so
	// arbitrary markup can never enter the document; the mark set is the vocabulary
	// the renderer (`InlineRuns.svelte`) honours, so the live preview reflects every
	// toggle. `linkTo` (the Epic 11 internal-link twin) is left untouched: editing a
	// run's text/marks/link mutates the run in place and preserves any field this
	// editor does not surface.
	//
	// The bound `paragraphs` array is always non-empty while present (`minParagraphs`
	// floors the inner remove control); an OPTIONAL rich-text field (list description,
	// milestone detail) is added and removed as a whole by the parent, which mounts
	// this editor only when the field is present.
	interface Props {
		paragraphs: Paragraph[];
		/**
		 * Optional prefix that scopes every control's accessible name and the legend
		 * to a specific rich-text field (e.g. "Callout body", "Item 2 description"),
		 * so several run-bearing fields on one block stay distinguishable. Omitted for
		 * the text block, whose paragraphs are the whole block (the bare "Paragraph N"
		 * scheme Story 10.3 established, kept byte-stable).
		 */
		label?: string;
		/** The floor the inner paragraph Remove control respects. 1 for a required body. */
		minParagraphs?: number;
		onEdit: () => void;
	}

	let { paragraphs = $bindable(), label, minParagraphs = 1, onEdit }: Props = $props();

	// "Paragraph" alone for the text block (no prefix), "<label> paragraph" otherwise.
	// The prefixed form keeps several run-bearing fields on one block distinguishable;
	// the bare form keeps the text block's Story 10.3 accessible names byte-stable.
	const paragraphNoun = $derived(label ? `${label} paragraph` : 'Paragraph');

	// The field-level run text/mark/link inputs read "<noun> N, run M <suffix>".
	function runField(paragraphIndex: number, runIndex: number, suffix: string): string {
		return `${paragraphNoun} ${paragraphIndex + 1}, run ${runIndex + 1} ${suffix}`;
	}

	// The icon-style action controls read "<verb> [<label>] run/paragraph N", verb
	// first (the Story 10.3 form): "Remove run 2", "Add paragraph", and with a label
	// "Remove callout body run 2", "Add callout body paragraph".
	const scope = $derived(label ? `${label} ` : '');

	const MARK_LABELS: Record<(typeof RUN_MARKS)[number], string> = {
		bold: 'Bold',
		italic: 'Italic',
		code: 'Code'
	};
</script>

{#each paragraphs as paragraph, paragraphIndex (paragraphIndex)}
	<fieldset class="paragraph">
		<legend>{paragraphNoun} {paragraphIndex + 1}</legend>
		{#each paragraph as run, runIndex (runIndex)}
			<div class="run">
				<div class="run-text">
					<input
						value={run.text}
						placeholder="Run text"
						oninput={(event) => {
							run.text = event.currentTarget.value;
							onEdit();
						}}
						aria-label={runField(paragraphIndex, runIndex, 'text')}
					/>
					<div class="run-controls">
						<Button
							onclick={() => {
								moveItem(paragraph, runIndex, -1);
								onEdit();
							}}
							disabled={runIndex === 0}
						>
							<span class="sr-only">{`Move ${scope}run ${runIndex + 1} left`}</span>
							<span aria-hidden="true">Left</span>
						</Button>
						<Button
							onclick={() => {
								moveItem(paragraph, runIndex, 1);
								onEdit();
							}}
							disabled={runIndex === paragraph.length - 1}
						>
							<span class="sr-only">{`Move ${scope}run ${runIndex + 1} right`}</span>
							<span aria-hidden="true">Right</span>
						</Button>
						<Button
							variant="ghost"
							onclick={() => {
								paragraph.splice(runIndex, 1);
								onEdit();
							}}
							disabled={paragraph.length === 1}
						>
							<span class="sr-only">{`Remove ${scope}run ${runIndex + 1}`}</span>
							<span aria-hidden="true">Remove</span>
						</Button>
					</div>
				</div>
				<div class="run-marks">
					{#each RUN_MARKS as mark (mark)}
						<label class="mark">
							<input
								type="checkbox"
								checked={run[mark] ?? false}
								onchange={() => {
									toggleRunMark(run, mark);
									onEdit();
								}}
								aria-label={runField(paragraphIndex, runIndex, MARK_LABELS[mark])}
							/>
							{MARK_LABELS[mark]}
						</label>
					{/each}
					<input
						class="run-link"
						type="url"
						value={run.link?.href ?? ''}
						placeholder="Link URL (optional)"
						oninput={(event) => {
							setRunLink(run, event.currentTarget.value);
							onEdit();
						}}
						aria-label={runField(paragraphIndex, runIndex, 'link URL')}
					/>
				</div>
			</div>
		{/each}
		<div class="paragraph-controls">
			<Button
				onclick={() => {
					paragraph.push(newRun());
					onEdit();
				}}
			>
				<span class="sr-only">{`Add run to ${scope}paragraph ${paragraphIndex + 1}`}</span>
				<span aria-hidden="true">Add run</span>
			</Button>
			<Button
				variant="ghost"
				onclick={() => {
					paragraphs.splice(paragraphIndex, 1);
					onEdit();
				}}
				disabled={paragraphs.length <= minParagraphs}
			>
				<span class="sr-only">{`Remove ${scope}paragraph ${paragraphIndex + 1}`}</span>
				<span aria-hidden="true">Remove paragraph</span>
			</Button>
		</div>
	</fieldset>
{/each}
<Button
	onclick={() => {
		paragraphs.push([newRun()]);
		onEdit();
	}}
>
	<span class="sr-only">{`Add ${scope}paragraph`}</span>
	<span aria-hidden="true">Add paragraph</span>
</Button>

<style>
	.paragraph {
		margin: 0 0 var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	.paragraph legend {
		padding: 0 var(--space-2);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink-65);
	}

	.run {
		margin-bottom: var(--space-3);
		padding-bottom: var(--space-3);
		border-bottom: 1px dashed var(--color-ink-12);
	}

	.run:last-of-type {
		margin-bottom: 0;
		padding-bottom: 0;
		border-bottom: 0;
	}

	.run-text {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.run-text input {
		flex: 1;
		min-width: 0;
	}

	.run-controls {
		display: flex;
		gap: var(--space-1);
	}

	.run-marks {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.mark {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}

	.run-link {
		flex: 1;
		min-width: 140px;
	}

	.paragraph-controls {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	input {
		padding: var(--space-2) var(--space-3);
		font: inherit;
		color: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	input[type='checkbox'] {
		padding: 0;
	}

	/* Accessible name for the icon-style move/remove controls (WCAG 2.5.3): the full
	   descriptive name is in a visually-hidden span, the visible glyph is aria-hidden.
	   Kept component-scoped (not only in the shared form-fields.css) so the control is
	   off-screen even when this editor renders outside the workspace layout. */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
