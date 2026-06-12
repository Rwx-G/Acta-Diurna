/**
 * Reader-path JS budget check (NFR3: < 200 KB compressed).
 *
 * Walks the built client manifest from the reader view route's page node,
 * follows the full transitive import closure (the JS the browser actually
 * downloads to hydrate that route, plus the shared entry/start), and sums the
 * gzipped bytes. Prints a table and exits non-zero if the budget is exceeded.
 *
 * Run after `pnpm build`:  node scripts/reader-bundle-size.ts
 */
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BUDGET_BYTES = 200 * 1024;
const CLIENT_DIR = path.resolve(process.cwd(), '.svelte-kit/output/client');
const MANIFEST = path.join(CLIENT_DIR, '.vite/manifest.json');

interface ManifestChunk {
	file: string;
	imports?: string[];
	dynamicImports?: string[];
}

type Manifest = Record<string, ManifestChunk>;

function gzipSize(file: string): number {
	const buffer = readFileSync(path.join(CLIENT_DIR, file));
	return gzipSync(buffer).length;
}

/** Collects the static-import closure of a set of manifest keys. */
function closure(manifest: Manifest, roots: string[]): Set<string> {
	const files = new Set<string>();
	const seen = new Set<string>();
	const stack = [...roots];
	while (stack.length > 0) {
		const key = stack.pop()!;
		if (seen.has(key)) continue;
		seen.add(key);
		const chunk = manifest[key];
		if (!chunk) continue;
		// Only JS counts against the reader-path JS budget (NFR3). CSS and font
		// files are accounted separately; here we sum the hydration JS.
		if (chunk.file.endsWith('.js')) files.add(chunk.file);
		for (const next of chunk.imports ?? []) stack.push(next);
	}
	return files;
}

function findKey(manifest: Manifest, suffix: string): string | undefined {
	return Object.keys(manifest).find((key) => key.endsWith(suffix));
}

function main(): void {
	const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;

	// Roots the browser loads to hydrate the reader view (node 8, a +page@.svelte
	// that resets to the root layout node 0 - it does NOT pull the workspace
	// layout): the SvelteKit client entry app, the root layout node and the view
	// page node. Node numbers come from the build (see the Dev Agent Record).
	const roots: string[] = [];
	const appEntry = findKey(manifest, 'client-optimized/app.js');
	if (appEntry) roots.push(appEntry);
	const rootLayout = findKey(manifest, 'client-optimized/nodes/0.js');
	const viewPage = findKey(manifest, 'client-optimized/nodes/8.js');
	if (!viewPage || !rootLayout) {
		console.error('Could not locate the reader view nodes (0/8) in the client manifest.');
		process.exit(2);
	}
	roots.push(rootLayout, viewPage);

	const files = closure(manifest, roots);
	const rows = [...files]
		.map((file) => ({ file, bytes: gzipSize(file) }))
		.sort((a, b) => b.bytes - a.bytes);

	const total = rows.reduce((sum, row) => sum + row.bytes, 0);

	console.log('Reader-path JS (gzipped), view route closure:\n');
	for (const row of rows) {
		console.log(`  ${(row.bytes / 1024).toFixed(1).padStart(7)} KB  ${row.file}`);
	}
	console.log('  ' + '-'.repeat(40));
	console.log(`  ${(total / 1024).toFixed(1).padStart(7)} KB  TOTAL`);
	console.log(`  budget: ${(BUDGET_BYTES / 1024).toFixed(0)} KB (NFR3)`);

	if (total > BUDGET_BYTES) {
		console.error(
			`\nFAIL: reader-path JS ${(total / 1024).toFixed(1)} KB exceeds the 200 KB budget.`
		);
		process.exit(1);
	}
	console.log(`\nOK: ${(total / 1024).toFixed(1)} KB is within the 200 KB budget.`);
}

main();
