<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatUtcDateTime } from '$lib/format';
	import Button from '$lib/ui/Button.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let fileInput: HTMLInputElement | undefined = $state();
	let progress = $state<number | null>(null);
	let uploading = $state(false);
	let message = $state<string | null>(null);
	let messageVariant = $state<'ok' | 'error'>('ok');
	let selectedName = $state<string | null>(null);
	let dragOver = $state(false);

	function syncSelected(): void {
		selectedName = fileInput?.files?.[0]?.name ?? null;
	}

	function onDrop(event: DragEvent): void {
		event.preventDefault();
		dragOver = false;
		const files = event.dataTransfer?.files;
		if (files && files.length && fileInput) {
			fileInput.files = files;
			syncSelected();
		}
	}

	// Upload with visible progress (UX Flow): a plain form action gives no
	// progress events, so the JS path posts via XHR and reads upload.onprogress.
	// The no-JS baseline is the same `?/upload` form action, just without the bar.
	function upload(event: SubmitEvent): void {
		event.preventDefault();
		const file = fileInput?.files?.[0];
		if (!file) {
			message = 'Choose a file to upload.';
			messageVariant = 'error';
			return;
		}

		const body = new FormData();
		body.set('file', file);

		const request = new XMLHttpRequest();
		request.open('POST', '?/upload');
		request.upload.addEventListener('progress', (progressEvent) => {
			if (progressEvent.lengthComputable) {
				progress = Math.round((progressEvent.loaded / progressEvent.total) * 100);
			}
		});
		request.addEventListener('load', () => {
			uploading = false;
			progress = null;
			let parsed: { type?: string; data?: string } | undefined;
			try {
				parsed = JSON.parse(request.responseText) as { type?: string; data?: string };
			} catch {
				parsed = undefined;
			}
			if (request.status >= 200 && request.status < 300 && parsed?.type === 'success') {
				message = `Uploaded "${file.name}".`;
				messageVariant = 'ok';
				if (fileInput) fileInput.value = '';
				void invalidateAll();
			} else {
				message = readActionMessage(parsed) ?? 'Upload failed.';
				messageVariant = 'error';
			}
		});
		request.addEventListener('error', () => {
			uploading = false;
			progress = null;
			message = 'Upload failed: the server could not be reached.';
			messageVariant = 'error';
		});

		uploading = true;
		progress = 0;
		message = null;
		request.send(body);
	}

	// SvelteKit action responses serialize `data` as a stringified, deduplicated
	// array (devalue). The failure message is the first string entry; a robust
	// reader just scans for the first string so a shape change never throws.
	function readActionMessage(parsed: { data?: string } | undefined): string | null {
		if (!parsed?.data) return null;
		try {
			const decoded: unknown = JSON.parse(parsed.data);
			if (Array.isArray(decoded)) {
				const text = decoded.find((entry) => typeof entry === 'string' && entry.length > 1);
				return typeof text === 'string' ? text : null;
			}
		} catch {
			return null;
		}
		return null;
	}
</script>

<svelte:head>
	<title>Data sets - Acta Diurna</title>
</svelte:head>

<header class="head">
	<h1>Data sets</h1>
	<p class="lede">
		Upload a CSV or JSON file (up to 50 MB). Its columns are inspected so you can bind them to
		table, chart, and KPI blocks in a report.
	</p>
</header>

<form
	class="uploader"
	method="POST"
	action="?/upload"
	enctype="multipart/form-data"
	onsubmit={upload}
>
	<label
		class="dropzone"
		class:dragover={dragOver}
		ondragover={(event) => {
			event.preventDefault();
			dragOver = true;
		}}
		ondragleave={() => (dragOver = false)}
		ondrop={onDrop}
	>
		<input
			bind:this={fileInput}
			type="file"
			name="file"
			accept=".csv,.json,text/csv,application/json"
			aria-label="Data file"
			disabled={uploading}
			onchange={syncSelected}
		/>
		<svg class="dz-icon" viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
			<path
				d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 19h14"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
		<span class="dz-text">
			{#if selectedName}
				<strong>{selectedName}</strong>
				<span class="dz-hint">Click to choose a different file</span>
			{:else}
				<strong>Drop a CSV or JSON file here</strong>
				<span class="dz-hint">or click to choose - up to 50 MB</span>
			{/if}
		</span>
	</label>
	<Button type="submit" variant="primary" disabled={uploading}>
		{uploading ? 'Uploading...' : 'Upload'}
	</Button>
</form>

{#if progress !== null}
	<div
		class="progress"
		role="progressbar"
		aria-valuenow={progress}
		aria-valuemin={0}
		aria-valuemax={100}
	>
		<div class="bar" style="width: {progress}%"></div>
		<span class="pct">{progress}%</span>
	</div>
{/if}

{#if message}
	<p class="message {messageVariant}" role="status">{message}</p>
{/if}

{#if data.dataSets.length === 0}
	<EmptyState
		title="No data sets yet"
		description="Upload a CSV or JSON file to inspect its columns."
	/>
{:else}
	<ul class="list">
		{#each data.dataSets as dataSet (dataSet.id)}
			<li class="card">
				<div class="card-head">
					<span class="filename">{dataSet.filename}</span>
					<span class="format">{dataSet.sourceFormat}</span>
					<span class="injected">{formatUtcDateTime(dataSet.injectedAt)}</span>
				</div>
				<table class="fields">
					<thead>
						<tr><th>Field</th><th>Type</th></tr>
					</thead>
					<tbody>
						{#each dataSet.fields as field (field.name)}
							<tr>
								<td>{field.name}</td>
								<td><span class="type">{field.type}</span></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.head {
		max-width: 880px;
		margin-bottom: var(--space-5);
	}

	.lede {
		color: var(--color-ink-65);
	}

	.uploader {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
		max-width: 880px;
		margin-bottom: var(--space-4);
	}

	.dropzone {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-5);
		color: var(--color-ink-65);
		background: var(--color-surface);
		border: 1.5px dashed var(--color-ink-25);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition:
			border-color 120ms ease,
			background 120ms ease,
			color 120ms ease;
	}

	.dropzone:hover,
	.dropzone.dragover {
		color: var(--color-purple);
		border-color: var(--color-purple);
		background: var(--color-purple-08);
	}

	/* The native input stays in the tab order and accessible; the label is the
	   visible control (clicking it opens the picker). */
	.dropzone input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	.dz-icon {
		flex-shrink: 0;
	}

	.dz-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.dz-text strong {
		color: var(--color-ink);
		font-weight: 600;
	}

	.dz-hint {
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}

	.progress {
		position: relative;
		max-width: 880px;
		height: 20px;
		margin-bottom: var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.bar {
		height: 100%;
		background: var(--color-purple);
		transition: width 120ms linear;
	}

	.pct {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		font-size: 12px;
		color: var(--color-ink);
	}

	.message {
		max-width: 880px;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-sm);
		margin-bottom: var(--space-4);
	}

	.message.ok {
		color: var(--color-ink);
		background: var(--color-purple-08);
	}

	.message.error {
		color: var(--color-danger);
		background: var(--color-danger-08);
	}

	.list {
		display: grid;
		gap: var(--space-4);
		max-width: 880px;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.card {
		padding: var(--space-4);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	.card-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}

	.filename {
		font-weight: 600;
	}

	.format {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-purple);
	}

	.injected {
		margin-left: auto;
		font-size: 12px;
		color: var(--color-ink-65);
	}

	.fields {
		width: 100%;
		border-collapse: collapse;
	}

	.fields th,
	.fields td {
		padding: var(--space-1) var(--space-2);
		text-align: left;
		border-bottom: 1px solid var(--color-ink-12);
	}

	.fields th {
		font-size: 12px;
		color: var(--color-ink-65);
	}

	.type {
		font-size: 12px;
		padding: 0 var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-ink-65);
	}
</style>
