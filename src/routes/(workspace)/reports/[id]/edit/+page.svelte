<script lang="ts">
	import ReportEditor from './ReportEditor.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<!-- Keyed remount: navigating between report editors resets the editor state. -->
{#key data.report.id}
	<ReportEditor
		report={data.report}
		dataSets={data.dataSets}
		skeletons={data.skeletons}
		aiEnabled={data.aiEnabled}
		{form}
	/>
{/key}
