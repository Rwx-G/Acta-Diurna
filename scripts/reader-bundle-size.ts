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
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BUDGET_BYTES = 200 * 1024;
export const CLIENT_DIR = path.resolve(process.cwd(), '.svelte-kit/output/client');
const MANIFEST = path.join(CLIENT_DIR, '.vite/manifest.json');
const GENERATED_NODES = path.resolve(process.cwd(), '.svelte-kit/generated/client-optimized/nodes');

// The reader-path closure is anchored on the route SOURCE, never a numeric node
// index: SvelteKit assigns node numbers by route-tree order, so adding a route
// can renumber them and silently measure the wrong chunk. We resolve the node
// by the `+page`/`+layout` source it re-exports.
//
// The measured route is the PUBLIC reader surface `/r/[token]` (story 3.3): it
// hydrates whatever the verified report needs (the Report shell) PLUS the
// VerifyCard gateway, so it is the true reader-path JS the budget must bound -
// the author-only `/view` preview was the Epic 1 stand-in before the public
// route existed.
const VIEW_PAGE_SOURCE = 'src/routes/r/[token]/+page.svelte';
const ROOT_LAYOUT_SOURCE = 'src/routes/+layout.svelte';

interface ManifestChunk {
	file: string;
	imports?: string[];
	dynamicImports?: string[];
}

export type Manifest = Record<string, ManifestChunk>;

function gzipSize(file: string): number {
	const buffer = readFileSync(path.join(CLIENT_DIR, file));
	return gzipSync(buffer).length;
}

/** Collects the static-import closure of a set of manifest keys. */
export function closure(manifest: Manifest, roots: string[]): Set<string> {
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

/**
 * Resolves a SvelteKit node index by the route source it re-exports. Each
 * generated `client-optimized/nodes/<n>.js` is a one-line re-export of its
 * `+page`/`+layout` source; we match on that path so renumbering nodes cannot
 * point the budget at the wrong chunk.
 */
function nodeIndexForSource(sourceSuffix: string): number | undefined {
	const normalized = sourceSuffix.replace(/\\/g, '/');
	for (const file of readdirSync(GENERATED_NODES)) {
		const match = /^(\d+)\.js$/.exec(file);
		if (!match) continue;
		const contents = readFileSync(path.join(GENERATED_NODES, file), 'utf8').replace(/\\/g, '/');
		if (contents.includes(normalized)) return Number(match[1]);
	}
	return undefined;
}

function manifestKeyForNode(manifest: Manifest, index: number): string | undefined {
	return findKey(manifest, `client-optimized/nodes/${index}.js`);
}

/**
 * The JS files the browser statically downloads to hydrate the reader route
 * `/r/[token]` - the SvelteKit entry app, the root layout node and the view page
 * node, resolved by their route SOURCE (never a fixed numeric index, which
 * renumbers when routes are added). The single source of truth the budget check
 * and the reader-purity boundary test both build on, so they cannot drift apart.
 *
 * Throws (rather than `process.exit`) on a missing build artifact so an importing
 * caller - the boundary test - fails loudly instead of taking the whole process down.
 */
export function readerClosureFiles(): {
	files: string[];
	viewIndex: number;
	rootLayoutIndex: number;
} {
	const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;

	const roots: string[] = [];
	const appEntry = findKey(manifest, 'client-optimized/app.js');
	if (appEntry) roots.push(appEntry);

	const viewIndex = nodeIndexForSource(VIEW_PAGE_SOURCE);
	const rootLayoutIndex = nodeIndexForSource(ROOT_LAYOUT_SOURCE);
	if (viewIndex === undefined || rootLayoutIndex === undefined) {
		throw new Error(
			`Could not resolve the reader nodes by source ` +
				`(view: ${VIEW_PAGE_SOURCE}, layout: ${ROOT_LAYOUT_SOURCE}). Run \`pnpm build\` first.`
		);
	}

	const rootLayout = manifestKeyForNode(manifest, rootLayoutIndex);
	const viewPage = manifestKeyForNode(manifest, viewIndex);
	if (!viewPage || !rootLayout) {
		throw new Error(
			`Resolved nodes (layout ${rootLayoutIndex}, view ${viewIndex}) but could not ` +
				`find their keys in the client manifest. Run \`pnpm build\` first.`
		);
	}
	roots.push(rootLayout, viewPage);
	return { files: [...closure(manifest, roots)], viewIndex, rootLayoutIndex };
}

function main(): void {
	const { files, viewIndex, rootLayoutIndex } = readerClosureFiles();
	console.log(`Reader view node ${viewIndex}, root layout node ${rootLayoutIndex}\n`);

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

// Run the CLI report only when invoked directly (`node scripts/reader-bundle-size.ts`),
// not when imported by the reader-purity boundary test, which reuses the exported
// closure walker without printing the table or exiting the process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
