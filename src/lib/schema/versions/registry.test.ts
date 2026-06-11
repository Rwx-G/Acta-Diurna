import { describe, expect, it } from 'vitest';
import {
	getSchema,
	isSupportedVersion,
	schemaRegistry,
	SUPPORTED_VERSIONS,
	UnsupportedVersionError
} from './index.ts';
import { documentSchemaV1 } from './v1.ts';

describe('schema version registry', () => {
	it('maps version 1 to the v1 document schema', () => {
		expect(schemaRegistry[1]).toBe(documentSchemaV1);
		expect(getSchema(1)).toBe(documentSchemaV1);
	});

	it('declares the supported versions', () => {
		expect(SUPPORTED_VERSIONS).toEqual([1]);
		expect(isSupportedVersion(1)).toBe(true);
		expect(isSupportedVersion(2)).toBe(false);
	});

	it('throws a typed error carrying the supported range for unknown versions', () => {
		expect(() => getSchema(2)).toThrow(UnsupportedVersionError);
		try {
			getSchema(2);
			expect.fail('expected getSchema(2) to throw');
		} catch (error) {
			expect(error).toBeInstanceOf(UnsupportedVersionError);
			if (error instanceof UnsupportedVersionError) {
				expect(error.requestedVersion).toBe(2);
				expect(error.supportedVersions).toEqual([1]);
				expect(error.message).toBe('Unsupported document schema version 2. Supported versions: 1.');
			}
		}
	});
});
