/**
 * Ingestion domain barrel (FR12-16): upload + parse + inspect + store, binding
 * resolution, and the read queries the workspace consumes.
 */
export { ingestBytes, ingestFile, detectFormat, MAX_UPLOAD_BYTES } from './ingestion.ts';
export type {
	DataSet,
	IngestBytesInput,
	IngestInput,
	ParsedTable,
	SourceFormat
} from './ingestion.ts';

export { readStreamToCap } from './stream.ts';

export { bindBlock, getDataSet, listDataSets, readDataSetTable } from './queries.ts';
export type { DataSetSummary } from './queries.ts';

export { rebindReport, remapField } from './rebind.ts';
export type { RebindResult } from './rebind.ts';

export { diagnoseBlock, diagnoseDocument, summarize } from './diagnostics.ts';
export type { BindingState, BindingSummary, BlockDiagnostic, FieldDrift } from './diagnostics.ts';

export { closestField, levenshtein } from './distance.ts';
export type { ClosestMatch } from './distance.ts';

export { resolveTable, resolveChart, resolveKpi } from './resolve.ts';
export type { DataRow, ResolvedTable } from './resolve.ts';

export { applyBinding, buildBinding } from './bind.ts';
export type { SlotMapping } from './bind.ts';

export { inferColumnType, inferValueType, inspectFields } from './inspect.ts';
export type { FieldType } from './inspect.ts';

export { ParseError } from './errors.ts';
