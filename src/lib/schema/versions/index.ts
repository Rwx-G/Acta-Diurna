import { documentSchemaV1 } from './v1.ts';

export { documentSchemaV1 } from './v1.ts';
export type { DocumentV1, DocumentV1Input } from './v1.ts';

/** Version dispatch registry (FR7 groundwork): document version -> schema. */
export const schemaRegistry = {
	1: documentSchemaV1
} as const;

export type SupportedVersion = keyof typeof schemaRegistry;

export const SUPPORTED_VERSIONS = [1] as const satisfies readonly SupportedVersion[];

export class UnsupportedVersionError extends Error {
	readonly requestedVersion: number;
	readonly supportedVersions: readonly number[];

	constructor(requestedVersion: number) {
		super(
			`Unsupported document schema version ${requestedVersion}. ` +
				`Supported versions: ${SUPPORTED_VERSIONS.join(', ')}.`
		);
		this.name = 'UnsupportedVersionError';
		this.requestedVersion = requestedVersion;
		this.supportedVersions = SUPPORTED_VERSIONS;
	}
}

export function isSupportedVersion(version: number): version is SupportedVersion {
	return Object.hasOwn(schemaRegistry, version);
}

/** Returns the schema for `version`, or throws {@link UnsupportedVersionError}. */
export function getSchema(version: number): (typeof schemaRegistry)[SupportedVersion] {
	if (!isSupportedVersion(version)) {
		throw new UnsupportedVersionError(version);
	}
	return schemaRegistry[version];
}
