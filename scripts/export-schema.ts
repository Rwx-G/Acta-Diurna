/**
 * Writes the published document JSON Schema to `static/schema/v1.json`.
 * Run via `pnpm schema:export` (requires Node >= 22.18 for native type
 * stripping; the repo pins Node 22 via `.nvmrc`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURRENT_SCHEMA_VERSION, toJsonSchema } from '../src/lib/schema/index.ts';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(projectRoot, 'static', 'schema', `v${CURRENT_SCHEMA_VERSION}.json`);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(toJsonSchema(), null, '\t')}\n`);

console.log(`Document JSON Schema (v${CURRENT_SCHEMA_VERSION}) written to ${outputPath}`);
