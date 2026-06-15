<script lang="ts">
	import type { TextBlock } from '$lib/schema';
	import ParagraphsEditor from './ParagraphsEditor.svelte';

	// Direct inline-run editing (Story 10.3, extracted to the shared ParagraphsEditor
	// in Story 10.4). A text block IS its paragraphs, so it delegates the whole body
	// to the shared run-level editor with no field prefix - the bare "Paragraph N"
	// accessible-name scheme. The editor writes ONLY the marks the SCHEMA defines
	// (`inlineRunSchema`: bold / italic / inline-code, and an http(s) `link`); there
	// is no contenteditable and no HTML path, so arbitrary markup can never enter the
	// document. `linkTo` (the Epic 11 internal-link twin) is left untouched: editing a
	// run preserves any field this editor does not surface.
	interface Props {
		block: TextBlock;
		onEdit: () => void;
	}

	let { block = $bindable(), onEdit }: Props = $props();
</script>

<ParagraphsEditor bind:paragraphs={block.paragraphs} {onEdit} />
