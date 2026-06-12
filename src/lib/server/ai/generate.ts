/**
 * Outline-first generation (story 5.4, FR32). A two-stage orchestration OVER the
 * 5.3 connector - it never `fetch`es: every LLM call goes through `chatComplete`,
 * which asserts BOTH gates (configured AND opted-in) before any outbound request,
 * so a disabled instance fails with the 5.3 `/problems/ai-generation-disabled`
 * 503 and issues no call.
 *
 * The two stages and the approval gate between them:
 *
 *   1. OUTLINE - `generateOutline` builds a BOUNDED prompt (the schema's block
 *      types + the skeleton structure + the data set's inspected fields, each
 *      capped) and asks the model for a STRUCTURED OUTLINE: proposed sections,
 *      block types, and one-line intents - NOT full content. The model output is
 *      UNTRUSTED: it is parsed DEFENSIVELY (it may carry prose around the JSON,
 *      be malformed, or have the wrong shape) and clamped to the schema DoS
 *      bounds (sections <= 100, blocks/section <= 200). On unparseable/invalid
 *      output the stage throws `/problems/ai-generation-failed` (502) NAMING the
 *      outline stage with a retry hint - nothing is ever written.
 *
 *   2. APPROVAL - the outline is returned to the author to review/edit/approve
 *      (UX Flow D). The approval is bound to the EXACT approved outline by a
 *      content hash (`outlineHash`): the hash travels with the fill request, a
 *      stateless round-trip with NO new table. At fill time the posted outline is
 *      re-hashed and compared; a mismatch (the author edited the outline after
 *      approving, or a stale approval) is rejected BEFORE any LLM call, so a fill
 *      can never run from a since-edited outline (the "re-approval required" AC).
 *
 *   3. FILL - `fillFromOutline` asks the model, per the approved outline, for the
 *      block CONTENT (again parsed defensively + bounded), then ASSEMBLES a
 *      DocumentV1 with SERVER-GENERATED slug ids (the model's ids are never
 *      trusted). The assembled document is persisted through the EXISTING service
 *      write path (`updateReportDocument` / `createReportWithDocument`) - the SAME
 *      validate-on-write every surface uses (AR5, no bypass). An invalid model
 *      document is rejected by `validateDocument` with the FR2 `errors[]` and the
 *      draft is left UNTOUCHED; generation writes ONLY on a fully valid fill.
 *
 * Untrusted-LLM posture: every model output is data assembled into a validated
 * document, never executed - no prompt-injection sink. The final write goes
 * through the service DoS caps (MAX_DOCUMENT_BYTES) like any other write, so an
 * oversized or malformed output fails cleanly with problem-details, never crashes
 * and never persists invalid.
 */
import { createHash } from 'node:crypto';
import { validateDocument, type DocumentV1, type DocumentV1Input } from '$lib/schema';
import {
	createReportWithDocument,
	updateReportDocument,
	type Report
} from '$lib/server/documents/reports';
import { getSkeleton } from '$lib/server/skeletons/skeletons';
import { getDataSet, readDataSetTable } from '$lib/server/ingestion';
import type { DataSetField } from '$lib/server/db/schema';
import { AppError } from '$lib/server/problem';
import { chatComplete, type ChatMessage } from './connector';

/** The stage a failure occurred in, surfaced to the author with a retry action. */
export type GenerationStage = 'outline' | 'content-fill';

/** Outline bounds, taken from the 1.2 schema DoS ceilings so a runaway model
 *  output is clamped to what a document could ever hold, not passed through. */
const MAX_OUTLINE_SECTIONS = 100;
const MAX_BLOCKS_PER_SECTION = 200;
/** Cap on a single intent/key-point string before it enters a prompt or outline. */
const MAX_INTENT_CHARS = 500;
/** Cap on the author's free-text intent fed into the prompt (untrusted input). */
const MAX_AUTHOR_INTENT_CHARS = 2000;
/** Cap on the data-set fields described to the model (bounds the prompt size). */
const MAX_DATA_SET_FIELDS = 100;
/** Cap on sample rows shown to the model so the fill is grounded but the prompt
 *  stays bounded. */
const MAX_SAMPLE_ROWS = 20;
/** Cap on raw model output length parsed defensively (oversized output is a
 *  failure, never an OOM). */
const MAX_MODEL_OUTPUT_CHARS = 200_000;

/** The block types generation can target. The data-bearing core of the schema;
 *  the model is told to use only these so the assembled document validates. */
const GENERATABLE_BLOCK_TYPES = ['text', 'kpi', 'table', 'chart'] as const;
type GeneratableBlockType = (typeof GENERATABLE_BLOCK_TYPES)[number];

function isGeneratableType(value: unknown): value is GeneratableBlockType {
	return (
		typeof value === 'string' && (GENERATABLE_BLOCK_TYPES as readonly string[]).includes(value)
	);
}

/** One proposed block in the outline: a type + a one-line intent. */
export interface OutlineBlock {
	type: GeneratableBlockType;
	intent: string;
}

/** One proposed section in the outline: a title + intent + its blocks. */
export interface OutlineSection {
	title: string;
	intent: string;
	blocks: OutlineBlock[];
}

/** The reviewable, bounded outline artifact (sections + key points). Held for the
 *  author to edit/approve before any content is written. */
export interface Outline {
	title: string;
	sections: OutlineSection[];
}

/** Inputs the generation orchestration reads. Both ids optional so an outline can
 *  be requested from a skeleton alone, a data set alone, or an intent alone; the
 *  workspace trigger requires at least an intent. */
export interface GenerationInput {
	/** The author's free-text intent (the narrative the report should follow). */
	intent: string;
	/** Optional skeleton to ground the outline structure on (2.2). */
	skeletonId?: string | null;
	/** Optional data set whose inspected fields ground the content (2.4). */
	dataSetId?: string | null;
	/** Correlates the connector's server-side warn log with this request. */
	requestId?: string;
}

function generationFailed(stage: GenerationStage, reason: string): AppError {
	// Distinct from the connector's transport `/problems/ai-generation-failed`
	// (unreachable endpoint): this is the orchestration's own parse/shape failure.
	// Same type + status so a triggering surface renders them identically, with
	// the failing STAGE named and a retry action in the detail (the third AC).
	return new AppError({
		status: 502,
		title: 'AI Generation Failed',
		type: '/problems/ai-generation-failed',
		detail: `AI generation failed at the ${stage} stage: ${reason} Retry the ${stage} stage.`
	});
}

function clampText(value: unknown, max: number): string {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim();
	return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Pulls the first balanced JSON object out of a model response. A model often
 * wraps its JSON in prose or a ```json fence; this extracts the outermost
 * `{ ... }` span and parses it. Returns null on anything unparseable - the caller
 * turns that into a staged failure, never a crash.
 */
function parseModelJson(raw: string): unknown {
	if (raw.length > MAX_MODEL_OUTPUT_CHARS) return null;
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');
	if (start === -1 || end === -1 || end <= start) return null;
	const span = raw.slice(start, end + 1);
	try {
		return JSON.parse(span);
	} catch {
		return null;
	}
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Describes a data set's inspected fields for a prompt, bounded. */
function describeFields(fields: readonly DataSetField[]): string {
	return fields
		.slice(0, MAX_DATA_SET_FIELDS)
		.map((field) => `${field.name} (${field.type})`)
		.join(', ');
}

/** A bounded sample of rows, JSON-stringified, to ground the fill. */
function describeSample(rows: readonly Record<string, unknown>[]): string {
	return JSON.stringify(rows.slice(0, MAX_SAMPLE_ROWS));
}

interface GenerationContext {
	skeletonStructure: string | null;
	fieldsDescription: string | null;
	sampleRows: string | null;
}

/** Reads the optional skeleton + data set into bounded prompt fragments. The
 *  skeleton/data set are read here; generation never re-ingests. */
async function loadContext(input: GenerationInput): Promise<GenerationContext> {
	let skeletonStructure: string | null = null;
	if (input.skeletonId) {
		const skeleton = await getSkeleton(input.skeletonId);
		skeletonStructure = JSON.stringify(
			skeleton.document.sections.map((section) => ({
				title: section.title,
				blocks: section.blocks.map((block) => block.type)
			}))
		);
	}

	let fieldsDescription: string | null = null;
	let sampleRows: string | null = null;
	if (input.dataSetId) {
		const dataSet = await getDataSet(input.dataSetId);
		fieldsDescription = describeFields(dataSet.fields);
		const table = await readDataSetTable(input.dataSetId);
		sampleRows = describeSample(table.rows);
	}

	return { skeletonStructure, fieldsDescription, sampleRows };
}

const OUTLINE_SYSTEM_PROMPT = [
	'You are an assistant that drafts the OUTLINE of an Acta Diurna report.',
	'An Acta Diurna document is a JSON structure of sections, each holding blocks.',
	`The block types you may propose are: ${GENERATABLE_BLOCK_TYPES.join(', ')}.`,
	'A text block holds narrative paragraphs. A kpi block holds labelled metric values.',
	'A table block holds tabular rows. A chart block holds a line/bar/area/pie series.',
	'',
	'Return ONLY a JSON object, no prose, of the shape:',
	'{ "title": string, "sections": [ { "title": string, "intent": string,',
	'  "blocks": [ { "type": one of the block types, "intent": string } ] } ] }',
	'Each intent is ONE short line describing what the section or block should cover.',
	'Do NOT write the full content - this is an outline only. Keep it concise.'
].join('\n');

function buildOutlineUserPrompt(input: GenerationInput, context: GenerationContext): string {
	const lines = [`Author intent: ${clampText(input.intent, MAX_AUTHOR_INTENT_CHARS)}`];
	if (context.skeletonStructure) {
		lines.push(`Skeleton structure to follow: ${context.skeletonStructure}`);
	}
	if (context.fieldsDescription) {
		lines.push(`Available data fields: ${context.fieldsDescription}`);
	}
	return lines.join('\n');
}

/**
 * Parses a model outline response DEFENSIVELY and clamps it to the schema bounds.
 * Returns null on anything that cannot yield at least one section with one block,
 * so the caller fails the outline stage rather than passing garbage forward.
 */
function parseOutline(raw: string, fallbackTitle: string): Outline | null {
	const parsed = asRecord(parseModelJson(raw));
	const rawSections = asArray(parsed.sections).slice(0, MAX_OUTLINE_SECTIONS);

	const sections: OutlineSection[] = [];
	for (const rawSection of rawSections) {
		const sectionRecord = asRecord(rawSection);
		const title = clampText(sectionRecord.title, MAX_INTENT_CHARS);
		if (!title) continue;

		const rawBlocks = asArray(sectionRecord.blocks).slice(0, MAX_BLOCKS_PER_SECTION);
		const blocks: OutlineBlock[] = [];
		for (const rawBlock of rawBlocks) {
			const blockRecord = asRecord(rawBlock);
			if (!isGeneratableType(blockRecord.type)) continue;
			blocks.push({
				type: blockRecord.type,
				intent: clampText(blockRecord.intent, MAX_INTENT_CHARS)
			});
		}
		if (blocks.length === 0) blocks.push({ type: 'text', intent: '' });
		sections.push({
			title,
			intent: clampText(sectionRecord.intent, MAX_INTENT_CHARS),
			blocks
		});
	}

	if (sections.length === 0) return null;
	const title = clampText(parsed.title, 300) || fallbackTitle;
	return { title, sections };
}

/**
 * Stage 1: produces a bounded, reviewable outline. Calls `chatComplete` (which
 * gates on configured + opted-in, so a disabled instance throws the 503 here and
 * makes no call) and parses the output defensively. Throws the outline-stage
 * `/problems/ai-generation-failed` 502 on unparseable/empty output - nothing is
 * written. The returned outline is the artifact the author reviews/approves.
 */
export async function generateOutline(input: GenerationInput): Promise<Outline> {
	const context = await loadContext(input);
	const messages: ChatMessage[] = [
		{ role: 'system', content: OUTLINE_SYSTEM_PROMPT },
		{ role: 'user', content: buildOutlineUserPrompt(input, context) }
	];

	const result = await chatComplete(messages, { temperature: 0.4, requestId: input.requestId });
	const fallbackTitle = clampText(input.intent, 300) || 'Generated Report';
	const outline = parseOutline(result.content, fallbackTitle);
	if (!outline) {
		throw generationFailed('outline', 'the model returned no usable outline.');
	}
	return outline;
}

/**
 * Canonical hash of an approved outline. Binds an approval to the EXACT outline
 * content: the hash travels with the fill request, and a mismatch at fill time
 * means the outline was edited after approval (or the approval is stale), so the
 * fill is refused before any LLM call. Stateless - no stored outline, no table.
 *
 * Normalizes the outline to a canonical shape before hashing so key order and
 * incidental whitespace do not change the hash; only the meaningful content does.
 */
export function hashOutline(outline: Outline): string {
	const canonical = {
		title: outline.title,
		sections: outline.sections.map((section) => ({
			title: section.title,
			intent: section.intent,
			blocks: section.blocks.map((block) => ({ type: block.type, intent: block.intent }))
		}))
	};
	return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function staleApproval(): AppError {
	return new AppError({
		status: 409,
		title: 'Outline approval is stale',
		type: '/problems/ai-outline-stale',
		detail:
			'The outline changed since it was approved. Re-approve the current outline before ' +
			'generating content.'
	});
}

const FILL_SYSTEM_PROMPT = [
	'You are an assistant that writes the CONTENT of an Acta Diurna report from an',
	'approved outline. Return ONLY a JSON object, no prose, of the shape:',
	'{ "sections": [ { "blocks": [ <block> ] } ] }, matching the approved outline',
	'section-for-section and block-for-block, in order.',
	'',
	'Each <block> is one of:',
	'- text:  { "type": "text", "paragraphs": [ ["a paragraph of plain text"] ] }',
	'- kpi:   { "type": "kpi", "items": [ { "label": string, "value": string|number,',
	'           "unit"?: string, "trend"?: "up"|"down"|"flat" } ] }',
	'- table: { "type": "table", "columns": [ { "key": string, "label": string } ],',
	'           "rows": [ { "<column key>": string|number } ] }',
	'- chart: { "type": "chart", "kind": "line"|"bar"|"area"|"pie",',
	'           "series": [ { "name": string, "points": [ { "x": string|number, "y": number } ] } ] }',
	'Ground tables, charts and kpis in the provided data when present. Keep text concise.'
].join('\n');

function buildFillUserPrompt(outline: Outline, context: GenerationContext): string {
	const lines = [`Approved outline: ${JSON.stringify(outline)}`];
	if (context.fieldsDescription) {
		lines.push(`Available data fields: ${context.fieldsDescription}`);
	}
	if (context.sampleRows) {
		lines.push(`Sample data rows: ${context.sampleRows}`);
	}
	return lines.join('\n');
}

/** A stable slug id from positional indices. The model's ids are never trusted;
 *  every block/section gets a server-generated valid slug so the assembled
 *  document passes `idSchema` regardless of model output. */
function slugId(prefix: string, ...parts: number[]): string {
	return `${prefix}-${parts.join('-')}`;
}

/**
 * Assembles a candidate block from one model block object against the outline's
 * intended type. The model's `type` is ignored in favor of the OUTLINE's type
 * (the author approved the shape); content fields are read defensively and a
 * block that cannot yield valid content falls back to a one-line text block so
 * the document stays well-formed and `validateDocument` is the only gate.
 */
function assembleBlock(
	outlineType: GeneratableBlockType,
	modelBlock: Record<string, unknown>,
	sectionIndex: number,
	blockIndex: number
): DocumentV1Input['sections'][number]['blocks'][number] {
	const id = slugId('block', sectionIndex + 1, blockIndex + 1);

	if (outlineType === 'kpi') {
		const items = asArray(modelBlock.items)
			.map((rawItem) => {
				const item = asRecord(rawItem);
				const label = clampText(item.label, 300);
				const value = typeof item.value === 'number' ? item.value : clampText(item.value, 300);
				if (!label || value === '') return null;
				const result: Record<string, unknown> = { label, value };
				const unit = clampText(item.unit, 300);
				if (unit) result.unit = unit;
				if (item.trend === 'up' || item.trend === 'down' || item.trend === 'flat') {
					result.trend = item.trend;
				}
				return result;
			})
			.filter((item): item is Record<string, unknown> => item !== null);
		if (items.length > 0) return { type: 'kpi', id, items } as never;
	}

	if (outlineType === 'table') {
		const columns = asArray(modelBlock.columns)
			.map((rawColumn) => {
				const column = asRecord(rawColumn);
				const key = clampText(column.key, 300);
				const label = clampText(column.label, 300) || key;
				return key ? { key, label } : null;
			})
			.filter((column): column is { key: string; label: string } => column !== null);
		if (columns.length > 0) {
			const keys = new Set(columns.map((column) => column.key));
			const rows = asArray(modelBlock.rows)
				.slice(0, 10_000)
				.map((rawRow) => {
					const row = asRecord(rawRow);
					const cells: Record<string, string | number> = {};
					for (const key of keys) {
						const cell = row[key];
						cells[key] = typeof cell === 'number' ? cell : clampText(cell, 5000);
					}
					return cells;
				});
			return { type: 'table', id, columns, rows } as never;
		}
	}

	if (outlineType === 'chart') {
		const kind = modelBlock.kind;
		const chartKind =
			kind === 'line' || kind === 'bar' || kind === 'area' || kind === 'pie' ? kind : 'bar';
		const series = asArray(modelBlock.series)
			.map((rawSeries) => {
				const seriesRecord = asRecord(rawSeries);
				const name = clampText(seriesRecord.name, 300);
				if (!name) return null;
				const points = asArray(seriesRecord.points)
					.slice(0, 10_000)
					.map((rawPoint) => {
						const point = asRecord(rawPoint);
						const x = typeof point.x === 'number' ? point.x : clampText(point.x, 300);
						const y = typeof point.y === 'number' ? point.y : Number(point.y);
						return Number.isFinite(y) ? { x, y } : null;
					})
					.filter((point): point is { x: string | number; y: number } => point !== null);
				return points.length > 0 ? { name, points } : null;
			})
			.filter(
				(item): item is { name: string; points: { x: string | number; y: number }[] } =>
					item !== null
			);
		if (series.length > 0) return { type: 'chart', id, kind: chartKind, series } as never;
	}

	// Default and text fallback: a text block from the model's paragraphs, or the
	// block intent as a single paragraph when no usable text was returned.
	const paragraphs = asArray(modelBlock.paragraphs)
		.map((rawParagraph) => {
			// A paragraph may be a string or an array of run strings/objects.
			if (typeof rawParagraph === 'string') {
				const text = clampText(rawParagraph, 5000);
				return text ? [{ text }] : null;
			}
			const runs = asArray(rawParagraph)
				.map((rawRun) => {
					if (typeof rawRun === 'string') {
						const text = clampText(rawRun, 5000);
						return text ? { text } : null;
					}
					const text = clampText(asRecord(rawRun).text, 5000);
					return text ? { text } : null;
				})
				.filter((run): run is { text: string } => run !== null);
			return runs.length > 0 ? runs : null;
		})
		.filter((paragraph): paragraph is { text: string }[] => paragraph !== null);

	const safeParagraphs =
		paragraphs.length > 0 ? paragraphs : [[{ text: 'Content to be written.' }]];
	return { type: 'text', id, paragraphs: safeParagraphs } as never;
}

/** Assembles a candidate DocumentV1Input from the model fill output against the
 *  approved outline. Server-generated ids throughout; the model output supplies
 *  only content, which `validateDocument` then accepts or rejects. */
function assembleDocument(outline: Outline, modelOutput: unknown): DocumentV1Input {
	const modelSections = asArray(asRecord(modelOutput).sections);
	const sections = outline.sections.map((outlineSection, sectionIndex) => {
		const modelSection = asRecord(modelSections[sectionIndex]);
		const modelBlocks = asArray(modelSection.blocks);
		const blocks = outlineSection.blocks.map((outlineBlock, blockIndex) =>
			assembleBlock(outlineBlock.type, asRecord(modelBlocks[blockIndex]), sectionIndex, blockIndex)
		);
		return {
			id: slugId('section', sectionIndex + 1),
			title: outlineSection.title,
			blocks
		};
	});
	return { version: 1, title: outline.title, sections };
}

export interface FillInput extends GenerationInput {
	/** The outline the author reviewed and approved. */
	outline: Outline;
	/** The hash of the outline AT APPROVAL TIME, bound client-side; re-checked here. */
	approvedHash: string;
}

/**
 * Stage 2: fills the approved outline into a complete document and persists it
 * through the existing service write. Re-checks the approval hash against the
 * posted outline FIRST (a stale/edited outline is a 409 before any LLM call),
 * then calls `chatComplete`, assembles a DocumentV1 with server ids, and writes:
 *
 * - `reportId` set: replaces the existing draft's document via
 *   `updateReportDocument` (validate-on-write; a published report 409s, a
 *   concurrent edit 409s with `expectedUpdatedAt`). The draft is touched ONLY on
 *   a fully valid fill; an invalid model document throws the validator's 422
 *   `errors[]` and the row is never written.
 * - `reportId` absent: seeds a new draft via `createReportWithDocument` (same
 *   validate-on-write).
 *
 * The assembled document is the ONLY thing the model influences; ids, structure,
 * and the write path are server-owned. No bypass of `validateDocument`.
 */
export async function fillFromOutline(
	input: FillInput,
	reportId?: string,
	expectedUpdatedAt?: Date
): Promise<Report> {
	if (hashOutline(input.outline) !== input.approvedHash) {
		throw staleApproval();
	}

	const context = await loadContext(input);
	const messages: ChatMessage[] = [
		{ role: 'system', content: FILL_SYSTEM_PROMPT },
		{ role: 'user', content: buildFillUserPrompt(input.outline, context) }
	];

	const result = await chatComplete(messages, { temperature: 0.3, requestId: input.requestId });
	const modelOutput = parseModelJson(result.content);
	if (modelOutput === null) {
		throw generationFailed('content-fill', 'the model returned unparseable content.');
	}

	const documentInput = assembleDocument(input.outline, modelOutput);

	// Final gate: the SAME validate-on-write every surface uses. An invalid model
	// document is rejected here with the FR2 errors[]; the draft stays untouched
	// because the write only happens on a valid document.
	if (reportId) {
		return updateReportDocument(reportId, documentInput, expectedUpdatedAt);
	}
	return createReportWithDocument(documentInput);
}

/** Validates an assembled document without writing - exposed for callers that
 *  want to surface validation errors before a write (and for tests). The service
 *  write re-validates, so this is a convenience, not the gate. */
export function validateAssembled(
	outline: Outline,
	modelOutput: unknown
): {
	ok: boolean;
	document?: DocumentV1;
} {
	const result = validateDocument(assembleDocument(outline, modelOutput));
	return result.ok ? { ok: true, document: result.document } : { ok: false };
}
