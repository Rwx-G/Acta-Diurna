<script lang="ts">
	import { Report, toReportView } from '$lib/render';
	import type { PageProps } from './$types';

	// The reader experience, author-side. SSR renders the full document; on the
	// client the Report shell hydrates only to wire SPA navigation. The view
	// model is built from the validated document the load returned.
	let { data }: PageProps = $props();

	const view = $derived(toReportView(data.document));
</script>

<svelte:head>
	<title>{data.document.title} - Acta Diurna</title>
	<!-- Reports are private artifacts; keep them out of search indexes (NFR10).
	     The future public reader /r/[token] (Epic 3) must carry the same tag. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#key data.document}
	<Report {view} mode="slide" />
{/key}
