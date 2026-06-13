import { describe, expect, it } from 'vitest';
import { MATRIX_FIXTURE_DOCUMENT, PHASE_B_FIXTURE_DOCUMENT } from '../../../e2e/fixtures.ts';
import { validateDocument } from './errors.ts';

/**
 * Guards the e2e fixtures the accessibility specs render. The seed insert in
 * `e2e/global-setup.ts` runs the same `validateDocument` and throws on a bad
 * fixture, but that only fires when the full e2e stack (Docker + a Postgres
 * testcontainer) is available. This unit check catches a malformed fixture in
 * the fast lane, so a typo in a scale reference or a block shape fails here long
 * before CI boots a container.
 */
describe('e2e accessibility fixtures', () => {
	it('the matrix fixture is a valid schema-v1 document', () => {
		expect(validateDocument(MATRIX_FIXTURE_DOCUMENT).ok).toBe(true);
	});

	it('the Phase B fixture is a valid schema-v1 document', () => {
		const result = validateDocument(PHASE_B_FIXTURE_DOCUMENT);
		expect(result.ok).toBe(true);
	});

	it('the Phase B fixture exercises every Phase B block type', () => {
		const result = validateDocument(PHASE_B_FIXTURE_DOCUMENT);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const blockTypes = new Set(
			result.document.sections.flatMap((section) => section.blocks.map((block) => block.type))
		);
		for (const type of [
			'callout',
			'code',
			'card-grid',
			'list',
			'timeline',
			'chip-cluster',
			'table'
		]) {
			expect(blockTypes.has(type as never)).toBe(true);
		}
	});
});
