/**
 * Exhaustiveness guard for discriminated-union dispatch. Reaching this at
 * runtime means a union member was added without a matching branch; TypeScript
 * fails to compile the call when the `x: never` parameter is not actually
 * `never`, so the missing branch is a compile error first, a thrown error only
 * as the runtime backstop. Used by the block-type dispatch seams (render,
 * scale cross-references, the editor block menu) so adding a block type forces a
 * conscious decision at each chokepoint.
 */
export function assertNever(x: never): never {
	throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}
