/**
 * Ingestion domain barrel (FR12-16): upload + parse + inspect + store, binding
 * resolution, and the read queries the workspace consumes.
 */
export { ingestFile, detectFormat, MAX_UPLOAD_BYTES } from './ingestion.ts';
export type { DataSet, IngestInput, ParsedTable, SourceFormat } from './ingestion.ts';

export { bindBlock, getDataSet, listDataSets, readDataSetTable } from './queries.ts';

export { resolveTable, resolveChart, resolveKpi } from './resolve.ts';
export type { DataRow, ResolvedTable } from './resolve.ts';

export { applyBinding, buildBinding } from './bind.ts';
export type { SlotMapping } from './bind.ts';

export { inferColumnType, inferValueType, inspectFields } from './inspect.ts';
export type { FieldType } from './inspect.ts';

export { ParseError } from './errors.ts';
