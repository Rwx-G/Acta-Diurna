import { describe, expect, it } from 'vitest';
import { resolveDataAsOf, type DataSet } from './ingestion.ts';

// The FR16 freshness-instant resolution (Story 6.4). `resolveDataAsOf` is the
// single precedence rule: the explicit `data_as_of` wins, the injection time is
// the fallback. `injected_at` is NOT NULL on the row, so a data set always yields
// a usable instant - the "no usable timestamp" case is a binding with no data set
// at all, which never reaches this function.
function dataSet(overrides: Partial<DataSet> = {}): DataSet {
	return {
		id: 'ds-1',
		reportId: null,
		filename: 'weekly.csv',
		sourceFormat: 'csv',
		fields: [{ name: 'week', type: 'date' }],
		injectedAt: new Date('2026-06-08T09:30:00.000Z'),
		dataAsOf: null,
		storagePath: '/uploads/ds-1.csv',
		...overrides
	};
}

describe('resolveDataAsOf', () => {
	it('prefers the explicit data_as_of over the injection time', () => {
		const set = dataSet({ dataAsOf: new Date('2026-06-01T00:00:00.000Z') });
		expect(resolveDataAsOf(set)).toBe('2026-06-01T00:00:00.000Z');
	});

	it('falls back to the injection time when data_as_of is absent', () => {
		expect(resolveDataAsOf(dataSet({ dataAsOf: null }))).toBe('2026-06-08T09:30:00.000Z');
	});

	it('returns an ISO-8601 string the binding schema accepts', () => {
		// The binding `dataAsOf` is `z.iso.datetime({ offset: true })`; the resolver
		// must emit a value that validates, so the bound document is never rejected.
		const resolved = resolveDataAsOf(dataSet());
		expect(resolved).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
	});
});
