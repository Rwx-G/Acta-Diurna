import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Tenancy guard (full-audit C3). Multi-author isolation (Epic 8) is enforced by
 * SERVICE DISCIPLINE - every query against an owning table ANDs `ownerFilter` into
 * its WHERE - not by the type system. A new `owner_id` table whose list forgets
 * `ownerFilter` COMPILES and PASSES the single-mode suite (the predicate is a no-op
 * there), leaking rows only in MULTI mode where no single-mode test exercises it.
 *
 * This grep-based guard closes that gap structurally: it discovers the set of
 * owning tables straight from the schema (so a new `owner_id` table is covered
 * automatically, with no edit here), then asserts every server file that queries
 * one of those tables routes through `ownerFilter` - unless the file is on an
 * explicit, REASONED allowlist of sanctioned unscoped reads. A future owning query
 * that forgets the predicate makes this test fail, in single mode, before review.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(HERE, '..');
const SCHEMA_FILE = join(SERVER_ROOT, 'db', 'schema.ts');

/**
 * The ONE sanctioned bypass surface (relative to src/lib/server). The reader path
 * `getRowUnscoped` in documents/reports.ts reads a published report by id with NO
 * owner predicate ON PURPOSE: a verified reader is gated by the share, not by
 * authorship, so it must reach the owning author's report. That file ALSO uses
 * `ownerFilter` on every AUTHOR surface, so it would pass the guard anyway; it is
 * listed here to DOCUMENT the bypass as deliberate, not to relax the check.
 *
 * Any future file that genuinely needs an unscoped read against an owning table
 * must be added here with its reason - the addition is the explicit, reviewed
 * decision the guard forces.
 */
const SANCTIONED_UNSCOPED: Record<string, string> = {
	'documents/reports.ts':
		'getRowUnscoped serves the reader path (share-gated, not author-gated); the file still owner-scopes every author surface.',
	'authors/inheritance.ts':
		'Boot-time backfill that assigns every owner-less legacy row to the implicit author (WHERE owner_id IS NULL); it is a SYSTEM operation that runs once before traffic, deliberately across all rows, not a tenant request.',
	'maintenance/purge.ts':
		'Retention/janitor sweep (orphan data sets, aged access records). It deletes by AGE policy across the whole instance, a SYSTEM maintenance operation with no author scope, registered at boot, never reachable from a tenant request.'
};

/** Drizzle query entry points that read or write rows of a table. */
const QUERY_VERBS = ['from', 'update', 'delete'] as const;

function listTsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...listTsFiles(full));
		} else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
			out.push(full);
		}
	}
	return out;
}

/**
 * Discovers the drizzle const names of every table carrying an `owner_id` column,
 * read from the schema source. A `pgTable('...', { ... ownerId: uuid('owner_id')
 * ... })` block is matched as `export const <name> = pgTable(`, and the block body
 * is checked for the `owner_id` column. This way a new owning table is picked up
 * here automatically.
 */
function owningTableConsts(): string[] {
	const source = readFileSync(SCHEMA_FILE, 'utf8');
	const tablePattern = /export const (\w+) = pgTable\(\s*'(\w+)'/g;
	const found: string[] = [];
	let match: RegExpExecArray | null;
	while ((match = tablePattern.exec(source)) !== null) {
		const constName = match[1];
		// The block body runs from this pgTable( to the next `export const` (or EOF).
		const bodyStart = match.index;
		const nextExport = source.indexOf('\nexport const ', bodyStart + 1);
		const body = source.slice(bodyStart, nextExport === -1 ? undefined : nextExport);
		if (body.includes("uuid('owner_id')")) found.push(constName);
	}
	return found;
}

function queriesTable(source: string, tableConst: string): boolean {
	return QUERY_VERBS.some((verb) => source.includes(`.${verb}(${tableConst})`));
}

describe('tenancy guard: owning tables route through ownerFilter', () => {
	const owningTables = owningTableConsts();
	const serverFiles = listTsFiles(SERVER_ROOT);

	it('discovers the owning tables from the schema (sanity: the set is non-empty and known)', () => {
		// reports, skeletons, dataSets, apiTokens carry owner_id today; the guard must
		// have found them. A regression that drops the column would shrink this set and
		// must be deliberate.
		expect(owningTables).toEqual(
			expect.arrayContaining(['reports', 'skeletons', 'dataSets', 'apiTokens'])
		);
	});

	it('every server file that queries an owning table uses ownerFilter (or is a sanctioned bypass)', () => {
		const offenders: { file: string; table: string }[] = [];

		for (const file of serverFiles) {
			const rel = relative(SERVER_ROOT, file).split('\\').join('/');
			const source = readFileSync(file, 'utf8');
			for (const table of owningTables) {
				if (!queriesTable(source, table)) continue;
				if (source.includes('ownerFilter')) continue;
				if (rel in SANCTIONED_UNSCOPED) continue;
				offenders.push({ file: rel, table });
			}
		}

		// A non-empty list names the file + table that queried an owning table without
		// owner scoping - the multi-mode leak this guard exists to catch.
		expect(offenders).toEqual([]);
	});

	it('the sanctioned-bypass allowlist is not stale (each entry still queries an owning table)', () => {
		for (const rel of Object.keys(SANCTIONED_UNSCOPED)) {
			const source = readFileSync(join(SERVER_ROOT, rel), 'utf8');
			const stillQueries = owningTables.some((table) => queriesTable(source, table));
			expect(
				stillQueries,
				`${rel} no longer queries an owning table; drop its allowlist entry`
			).toBe(true);
		}
	});
});
