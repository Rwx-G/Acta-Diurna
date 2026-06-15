<script lang="ts">
	import type { ReportStatus } from '$lib/server/documents/reports';

	// Standing states use chips (UX feedback patterns). Report lifecycle only
	// has these two states in Epic 1; binding chips arrive with Epic 2.
	interface Props {
		status: ReportStatus;
	}

	let { status }: Props = $props();
</script>

<span class="chip {status}">{status}</span>

<style>
	.chip {
		display: inline-block;
		padding: 2px var(--space-3);
		font-size: 12px;
		font-weight: 600;
		text-transform: capitalize;
		border-radius: var(--radius-pill);
	}

	.draft {
		/* ink-80 over the ink-12 chip keeps the muted look while clearing the
		   WCAG AA 4.5:1 floor (ink-65 resolved to 4.24:1, an axe contrast miss). */
		color: var(--color-ink-80);
		background: var(--color-ink-12);
	}

	.published {
		color: var(--color-green);
		background: var(--color-green-12);
	}
</style>
