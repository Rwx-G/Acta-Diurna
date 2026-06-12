/**
 * Read queries over `data_sets` for the inspector and bind UI. Writes live in
 * `ingestion.ts`; these are the projections the workspace reads.
 */
import { readFile } from 'node:fs/promises';
import { desc, eq } from 'drizzle-orm';
import { getReport, updateReportDocument, type Report } from '$lib/server/documents/reports';
import { getDb } from '$lib/server/db/client';
import { dataSets, type DataSetRow } from '$lib/server/db/schema';
import { AppError } from '$lib/server/problem';
import { applyBinding, type SlotMapping } from './bind.ts';
import { ParseError, unparseable } from './errors.ts';
import { parseCsv } from './csv.ts';
import { parseJson } from './json.ts';
import type { DataSet, ParsedTable, SourceFormat } from './ingestion.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function notFound(): AppError {
	return new AppError({
		status: 404,
		title: 'Data set not found',
		type: '/problems/data-set-not-found'
	});
}

function toDataSet(row: DataSetRow): DataSet {
	return {
		id: row.id,
		reportId: row.reportId ?? null,
		filename: row.filename,
		sourceFormat: row.sourceFormat as SourceFormat,
		fields: row.fields,
		injectedAt: row.injectedAt,
		dataAsOf: row.dataAsOf ?? null,
		storagePath: row.storagePath
	};
}

/** Lists data sets, most recently injected first. */
export async function listDataSets(): Promise<DataSet[]> {
	const rows = await getDb().select().from(dataSets).orderBy(desc(dataSets.injectedAt));
	return rows.map(toDataSet);
}

async function getRow(id: string): Promise<DataSetRow> {
	if (!UUID_PATTERN.test(id)) throw notFound();
	const rows = await getDb().select().from(dataSets).where(eq(dataSets.id, id)).limit(1);
	if (rows.length === 0) throw notFound();
	return rows[0];
}

/** Loads one data set's metadata; 404 on unknown or malformed id. */
export async function getDataSet(id: string): Promise<DataSet> {
	return toDataSet(await getRow(id));
}

/**
 * Re-reads and re-parses a stored data set's rows from the uploads volume. The
 * resolver consumes this at bind time so the bound block carries real data. The
 * file was validated at ingest, so a parse error here is an integrity fault.
 */
export async function readDataSetTable(id: string): Promise<ParsedTable> {
	const row = await getRow(id);
	const text = await readFile(row.storagePath, 'utf-8');
	return row.sourceFormat === 'csv' ? parseCsv(text) : parseJson(text);
}

/**
 * Binds a data set onto one block of a report (FR14): reads the data set's
 * fields and rows, applies the slot mapping to the named block, and writes the
 * updated document through the report service's validate-on-write path. The
 * binding (fields + slots) and the resolved static data both land in the
 * document, so the block renders the bound data and the binding persists - the
 * AC for 2.4. 404 if the block id is not in the report.
 */
export async function bindBlock(
	reportId: string,
	blockId: string,
	dataSetId: string,
	slotMapping: SlotMapping
): Promise<Report> {
	const dataSet = await getDataSet(dataSetId);
	const table = await readDataSetTable(dataSetId);
	const report = await getReport(reportId);

	const document = structuredClone(report.document);
	let found = false;
	for (const section of document.sections) {
		const index = section.blocks.findIndex((block) => block.id === blockId);
		if (index !== -1) {
			try {
				section.blocks[index] = applyBinding(
					section.blocks[index],
					dataSetId,
					dataSet.fields,
					slotMapping,
					table.rows
				);
			} catch (error) {
				// An incoherent slot mapping for the block type (e.g. a table with no
				// column slot) is author input, not a server fault: surface it as 422.
				if (error instanceof ParseError) throw unparseable(error);
				throw error;
			}
			found = true;
			break;
		}
	}
	if (!found) {
		throw new AppError({
			status: 404,
			title: 'Block not found',
			type: '/problems/block-not-found',
			detail: 'No block in this report matches the requested id.'
		});
	}
	return updateReportDocument(reportId, document);
}
