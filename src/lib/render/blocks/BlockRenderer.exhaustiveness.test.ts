import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blockSchema } from '$lib/schema';

/**
 * Compile-time `satisfies Record<BlockType, ...>` guards already make a forgotten
 * branch a build error at both seams (the render dispatch in BlockRenderer.svelte
 * and the block palette catalogue in editor-state.ts). These runtime tests are the
 * belt-and-braces backstop: they read the actual source and assert every block
 * type the schema declares appears as a dispatch arm and as a palette entry, so a
 * type silently dropped from either list fails a test even if a future refactor
 * weakens the typed guard.
 */

/** Every block `type` literal the discriminated union declares, from the schema. */
function allBlockTypes(): string[] {
	// Zod 4 exposes the union members on `.options`; each is an object schema whose
	// `type` field is a literal. Read the literal value defensively across the
	// public and internal shapes so a zod minor bump does not silently empty this.
	const options = (blockSchema as { options?: unknown[] }).options ?? [];
	return options.map((option) => {
		const def = (option as { def?: { shape?: { type?: { def?: { values?: unknown[] } } } } }).def;
		const values = def?.shape?.type?.def?.values;
		return String(Array.isArray(values) ? values[0] : '');
	});
}

function readSource(relativeToHere: string): string {
	return readFileSync(fileURLToPath(new URL(relativeToHere, import.meta.url)), 'utf8');
}

describe('block-type dispatch exhaustiveness', () => {
	const blockTypes = allBlockTypes();

	it('enumerates all 15 v1 block types from the schema', () => {
		expect(blockTypes).toHaveLength(15);
		expect(blockTypes).toContain('timeline');
		expect(new Set(blockTypes).size).toBe(blockTypes.length);
	});

	it('BlockRenderer dispatches every block type to a renderer', () => {
		const source = readSource('./BlockRenderer.svelte');
		for (const type of blockTypes) {
			expect(source).toContain(`view.block.type === '${type}'`);
		}
	});

	it('BlockRenderer carries a terminal {:else} invalid notice', () => {
		const source = readSource('./BlockRenderer.svelte');
		// The {:else} arm renders the same neutral notice as the view.block === null
		// path, so a validated-but-unhandled forward-version block never blanks.
		expect(source).toMatch(/\{:else\}[\s\S]*class="invalid"/);
	});

	it('the block palette catalogue offers an entry for every block type', () => {
		const source = readSource('../../../routes/(workspace)/reports/[id]/edit/editor-state.ts');
		for (const type of blockTypes) {
			// Hyphenated keys are quoted object keys (`'comparison-matrix': { ... }`),
			// bare identifiers are not (`text: { ... }`); accept either form, asserting
			// the catalogue entry opens an object (the palette label/description record).
			expect(source).toMatch(new RegExp(`'?${type}'?: \\{`));
		}
	});
});
