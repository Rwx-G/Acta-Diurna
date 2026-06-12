<script lang="ts">
	// Shared quiet placeholder for blocks that have no static data yet (chart,
	// KPI, table awaiting an Epic 2 data binding). One dashed frame, one muted
	// line - the CSS used to be triplicated across the three blocks.
	let { message = 'Awaiting data binding.' }: { message?: string } = $props();
</script>

<div class="block-placeholder">{message}</div>

<style>
	.block-placeholder {
		padding: var(--space-4);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		color: var(--report-text-muted);
		background: var(--report-surface);
		border: 1px dashed var(--report-rule-strong);
		border-radius: var(--radius-md);
	}
</style>
