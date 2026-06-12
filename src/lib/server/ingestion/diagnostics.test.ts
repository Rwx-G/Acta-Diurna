import { describe, expect, it } from 'vitest';
import type { Block, DocumentV1 } from '$lib/schema';
import { diagnoseBlock, diagnoseDocument, summarize } from './diagnostics.ts';

function tableBlock(id: string, fieldNames: string[]): Block {
	return {
		type: 'table',
		id,
		columns: [{ key: 'placeholder', label: 'Placeholder' }],
		rows: [],
		binding: {
			dataSetId: 'ds-old',
			fields: fieldNames.map((name) => ({ name, type: 'string', slot: { role: 'column' } }))
		}
	};
}

describe('diagnoseBlock', () => {
	it('is bound (green) when every slotted field is present', () => {
		const diagnostic = diagnoseBlock(tableBlock('t', ['severity', 'count']), 'Metrics', [
			'severity',
			'count',
			'extra'
		]);
		expect(diagnostic?.state).toBe('bound');
		expect(diagnostic?.drifts).toEqual([]);
	});

	it('is drifted (amber) when one field is renamed, naming the closest candidate', () => {
		// "severity" drifted to "Severity" (a case change, distance 1); "count"
		// still present -> amber, with the close rename proposed.
		const diagnostic = diagnoseBlock(tableBlock('t', ['severity', 'count']), 'Metrics', [
			'Severity',
			'count'
		]);
		expect(diagnostic?.state).toBe('drifted');
		expect(diagnostic?.drifts).toEqual([
			{ expected: 'severity', closest: 'Severity', distance: 1 }
		]);
	});

	it('is drifted when a field is missing with no near candidate (null closest)', () => {
		// "count" missing; the only available field is the present "severity", so
		// the closest to "count" is "severity" (a candidate still exists).
		const diagnostic = diagnoseBlock(tableBlock('t', ['severity', 'count']), 'Metrics', [
			'severity'
		]);
		expect(diagnostic?.state).toBe('drifted');
		expect(diagnostic?.drifts[0].expected).toBe('count');
		expect(diagnostic?.drifts[0].closest).toBe('severity');
	});

	it('proposes a null closest when the fresh data set is empty', () => {
		const diagnostic = diagnoseBlock(tableBlock('t', ['severity']), 'Metrics', []);
		expect(diagnostic?.state).toBe('unresolved');
		expect(diagnostic?.drifts).toEqual([{ expected: 'severity', closest: null }]);
	});

	it('is unresolved (red) when no slotted field is present', () => {
		const diagnostic = diagnoseBlock(tableBlock('t', ['severity', 'count']), 'Metrics', [
			'foo',
			'bar'
		]);
		expect(diagnostic?.state).toBe('unresolved');
		expect(diagnostic?.drifts).toHaveLength(2);
	});

	it('skips a block with no binding', () => {
		const block: Block = { type: 'text', id: 'x', paragraphs: [[{ text: 'hi' }]] };
		expect(diagnoseBlock(block, 'Intro', ['severity'])).toBeNull();
	});

	it('skips a bound block whose fields carry no slot (unmapped placeholder)', () => {
		const block: Block = {
			type: 'table',
			id: 't',
			columns: [{ key: 'k', label: 'K' }],
			rows: [],
			binding: { fields: [{ name: 'severity', type: 'string' }] }
		};
		expect(diagnoseBlock(block, 'Metrics', ['severity'])).toBeNull();
	});
});

function documentWith(blocks: Block[]): DocumentV1 {
	return {
		version: 1,
		title: 'Weekly',
		sections: [{ id: 'metrics', title: 'Metrics', blocks }]
	} as DocumentV1;
}

describe('diagnoseDocument + summarize', () => {
	it('aggregates an all-green report', () => {
		const document = documentWith([tableBlock('a', ['severity']), tableBlock('b', ['count'])]);
		const diagnostics = diagnoseDocument(document, ['severity', 'count']);
		const summary = summarize(diagnostics);
		expect(summary).toEqual({ total: 2, bound: 2, drifted: 0, unresolved: 0, allGreen: true });
	});

	it('aggregates a mixed report (green + amber + red)', () => {
		const document = documentWith([
			tableBlock('green', ['severity']),
			tableBlock('amber', ['severity', 'count']),
			tableBlock('red', ['alpha', 'beta'])
		]);
		// Available: severity present, count renamed to "counts", alpha/beta gone.
		const diagnostics = diagnoseDocument(document, ['severity', 'counts']);
		const summary = summarize(diagnostics);
		expect(summary.total).toBe(3);
		expect(summary.bound).toBe(1);
		expect(summary.drifted).toBe(1);
		expect(summary.unresolved).toBe(1);
		expect(summary.allGreen).toBe(false);
	});

	it('reports allGreen=false for an empty (no bound blocks) document', () => {
		const summary = summarize(diagnoseDocument(documentWith([]), ['severity']));
		expect(summary).toEqual({ total: 0, bound: 0, drifted: 0, unresolved: 0, allGreen: false });
	});
});
