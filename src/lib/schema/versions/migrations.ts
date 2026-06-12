/**
 * N/N-1 version dispatch (FR7, architecture cross-cutting concern 1). A stored
 * document may carry an earlier supported schema version; before it is
 * validated against the current schema it is lifted forward through a chain of
 * single-step migrations (v(k) -> v(k+1)).
 *
 * Today the registry is empty: v1 is the only and current version, so a v1
 * document is already current and migrates to itself by identity. The mechanism
 * exists and is exercised end to end by a synthetic v0 fixture in the tests
 * (never a registered production version) so the day a real v2 lands, adding one
 * `{ from: 1, to: 2, migrate }` entry is the whole change - the render path
 * already runs every stored document through here.
 */

/** The version the renderer and the live schema understand. */
export const CURRENT_SCHEMA_VERSION = 1;

/** One forward step of the migration chain: rewrites a v`from` document to v`to`. */
export interface DocumentMigration {
	readonly from: number;
	readonly to: number;
	/** Pure transform; receives the raw (untrusted) document, returns the next-version raw document. */
	migrate(document: Record<string, unknown>): Record<string, unknown>;
}

/**
 * Production migration registry. Empty while v1 is the only version. A future
 * v2 registers `{ from: 1, to: 2, migrate }` here (and adds `versions/v2.ts` +
 * `schemaRegistry` entry); nothing in the render path changes.
 */
export const DOCUMENT_MIGRATIONS: readonly DocumentMigration[] = [];

export class MigrationPathError extends Error {
	readonly fromVersion: number;
	readonly toVersion: number;

	constructor(fromVersion: number, toVersion: number) {
		super(`No migration path from document schema version ${fromVersion} to ${toVersion}.`);
		this.name = 'MigrationPathError';
		this.fromVersion = fromVersion;
		this.toVersion = toVersion;
	}
}

function readVersion(document: Record<string, unknown>): number {
	const version = document['version'];
	return typeof version === 'number' ? version : Number.NaN;
}

/**
 * Lifts a raw document forward through the migration chain until it reaches
 * `target` (default: the current schema version). An already-current document is
 * returned unchanged. A version with no outgoing migration toward the target
 * throws {@link MigrationPathError} - the caller surfaces it as the
 * unsupported-version problem with the supported range.
 *
 * `migrations` is injectable so tests can exercise the real walk with a
 * synthetic v0 -> v1 step without registering a fake production version.
 */
export function migrateToVersion(
	document: Record<string, unknown>,
	target: number = CURRENT_SCHEMA_VERSION,
	migrations: readonly DocumentMigration[] = DOCUMENT_MIGRATIONS
): Record<string, unknown> {
	let current = document;
	let version = readVersion(current);
	// Bounded by the number of registered migrations: each step strictly
	// advances `version`, so a chain of N migrations needs at most N steps. The
	// post-loop `version !== target` check below covers the case where the loop
	// exhausts the bound without reaching the target.
	for (let step = 0; version !== target && step < migrations.length; step += 1) {
		const next = migrations.find((migration) => migration.from === version);
		if (next === undefined) {
			throw new MigrationPathError(version, target);
		}
		current = next.migrate(current);
		version = next.to;
	}
	if (version !== target) {
		throw new MigrationPathError(readVersion(document), target);
	}
	return current;
}
