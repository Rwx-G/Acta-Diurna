<script lang="ts">
	import SkeletonComposer from './SkeletonComposer.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<SkeletonComposer {form} />
