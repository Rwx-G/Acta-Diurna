import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLIENT_DIR, readerClosureFiles } from './reader-bundle-size.ts';

/**
 * Reader-purity boundary (Epic 10.1, finding follow-up). The aggregate 200 KB
 * budget (`reader-bundle-size.ts` main) bounds the reader-path JS by SIZE, but a
 * future import of the server-and-load validation machinery
 * (`validateDocument` / `migrateToVersion` / `schemaRegistry` /
 * `MigrationPathError`) into a render-tier or reader-shared chunk could slip the
 * boundary while there is headroom and stay green. This pins the invariant by
 * CONTENTS instead of size: NO chunk in the reader's static-import closure may
 * carry the version-registry / migration-chain fingerprints.
 *
 * The fingerprints are RUNTIME STRING LITERALS that minification preserves (it
 * mangles identifiers, not string contents), so a symbol-name match would be
 * defeated by the production minifier but these literals survive:
 *  - `Supported document schema versions` - the `SUPPORTED_VERSIONS_HINT` text in
 *    `src/lib/schema/errors.ts`, emitted by `validateDocument`'s version-error path.
 *  - `No migration path from document schema version` - the `MigrationPathError`
 *    message in `src/lib/schema/versions/migrations.ts`, on the migration chain.
 *
 * Either string appearing in a reader chunk means the registry/migration graph
 * was pulled into the reader path - exactly the regression the editor's
 * `documentSchemaV1`-over-`validateDocument` decision avoids (story 10.1 Dev Notes).
 *
 * The test needs a build artifact (`pnpm build`) and skips with a clear message
 * when absent, so it never fails spuriously in a manifest-less environment; the
 * CI-equivalent local gates run `pnpm build` first.
 */

const FORBIDDEN_FINGERPRINTS = [
	'Supported document schema versions',
	'No migration path from document schema version'
];

const manifestExists = existsSync(path.join(CLIENT_DIR, '.vite/manifest.json'));

describe.skipIf(!manifestExists)('reader-path purity boundary', () => {
	it('ships no version-registry / migration-chain code in the reader closure', () => {
		const { files } = readerClosureFiles();
		expect(files.length).toBeGreaterThan(0);

		const offenders: { file: string; fingerprint: string }[] = [];
		for (const file of files) {
			const contents = readFileSync(path.join(CLIENT_DIR, file), 'utf8');
			for (const fingerprint of FORBIDDEN_FINGERPRINTS) {
				if (contents.includes(fingerprint)) offenders.push({ file, fingerprint });
			}
		}

		expect(
			offenders,
			`Reader chunks must not carry the validation/migration machinery, but found: ` +
				offenders.map((o) => `"${o.fingerprint}" in ${o.file}`).join('; ')
		).toEqual([]);
	});
});
