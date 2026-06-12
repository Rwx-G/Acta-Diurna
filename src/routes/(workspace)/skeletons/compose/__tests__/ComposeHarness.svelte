<script lang="ts">
	// Test-only harness wiring BrickCard -> StructureTree exactly as the composer
	// does, without the SvelteKit form/app context the full page pulls in. Proves
	// the brick-click-to-structure-append flow (UX Flow A) in a browser test.
	import { BRICKS } from '$lib/bricks';
	import type { DocumentV1Input } from '$lib/schema';
	import BrickCard from '$lib/ui/BrickCard.svelte';
	import StructureTree from '../StructureTree.svelte';
	import { appendBrick, newSkeletonDraft, type ErrorsByKey } from '../compose-state';

	let draft = $state<DocumentV1Input>(newSkeletonDraft(BRICKS[0]));
	const errors: ErrorsByKey = {};
</script>

<div>
	{#each BRICKS as brick (brick.id)}
		<BrickCard {brick} onAdd={() => appendBrick(draft, brick)} />
	{/each}
	<StructureTree bind:sections={draft.sections} {errors} onChange={() => {}} />
</div>
