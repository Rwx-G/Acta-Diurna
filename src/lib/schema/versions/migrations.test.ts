import { describe, expect, it } from 'vitest';
import {
	CURRENT_SCHEMA_VERSION,
	DOCUMENT_MIGRATIONS,
	migrateToVersion,
	MigrationPathError
} from './migrations.ts';
import { syntheticV0Document, syntheticV0Migration } from './synthetic-v0.fixture.ts';

describe('document migration chain', () => {
	it('returns a current-version document unchanged (identity, no registered migrations)', () => {
		const current = { version: CURRENT_SCHEMA_VERSION, title: 'X', sections: [] };
		expect(migrateToVersion(current)).toBe(current);
	});

	it('ships no production migrations while v1 is the only version', () => {
		expect(DOCUMENT_MIGRATIONS).toEqual([]);
	});

	it('lifts a synthetic v0 document forward through the injected v0 -> v1 step', () => {
		const migrated = migrateToVersion(syntheticV0Document, 1, [syntheticV0Migration]);

		expect(migrated.version).toBe(1);
		expect(migrated.title).toBe('Legacy Quarterly Report');
		expect('name' in migrated).toBe(false);
		expect(migrated.sections).toEqual(syntheticV0Document.sections);
	});

	it('throws MigrationPathError when no step reaches the target version', () => {
		expect(() => migrateToVersion({ version: 99, title: 'Y', sections: [] })).toThrow(
			MigrationPathError
		);
		try {
			migrateToVersion({ version: 0, title: 'Z', sections: [] });
			expect.fail('expected a MigrationPathError for an unreachable version');
		} catch (error) {
			expect(error).toBeInstanceOf(MigrationPathError);
			if (error instanceof MigrationPathError) {
				expect(error.fromVersion).toBe(0);
				expect(error.toVersion).toBe(CURRENT_SCHEMA_VERSION);
			}
		}
	});
});
