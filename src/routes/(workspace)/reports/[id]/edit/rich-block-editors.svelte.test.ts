import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import {
	validateDocument,
	type CalloutBlock,
	type ChipClusterBlock,
	type ComparisonMatrixBlock,
	type DocumentV1Input,
	type LegendBlock,
	type ListBlock,
	type Scales,
	type SetMembershipBlock,
	type TimelineBlock
} from '$lib/schema';
import CalloutBlockEditor from './CalloutBlockEditor.svelte';
import ChipClusterBlockEditor from './ChipClusterBlockEditor.svelte';
import ComparisonMatrixBlockEditor from './ComparisonMatrixBlockEditor.svelte';
import LegendBlockEditor from './LegendBlockEditor.svelte';
import ListBlockEditor from './ListBlockEditor.svelte';
import SetMembershipBlockEditor from './SetMembershipBlockEditor.svelte';
import TimelineBlockEditor from './TimelineBlockEditor.svelte';

// Story 10.4: per-block-type FIELD editing for the Epic 7 reporting and rich
// blocks. Each test mutates the bound $state block in place and reads the same
// object reference back. The run-bearing blocks (callout / list / timeline) edit
// their rich text through the SHARED inline-run editor (the schema's marks, never
// freeform HTML); the scale-driven blocks pick their refs from the DECLARED scales
// (a dropdown, never a free-typed dangling key).

// A two-scale fixture: a severity (ordinal) scale and a sources (nominal) scale,
// the shape the matrix / timeline / legend / chip-cluster editors resolve their
// option lists against.
const SCALES: Scales = [
	{
		key: 'severity',
		label: 'Severity',
		kind: 'ordinal',
		entries: [
			{ key: 'critical', label: 'Critical' },
			{ key: 'high', label: 'High' },
			{ key: 'low', label: 'Low' }
		]
	},
	{
		key: 'sources',
		label: 'Sources',
		kind: 'nominal',
		entries: [
			{ key: 'siem', label: 'SIEM' },
			{ key: 'edr', label: 'EDR' }
		]
	}
];

function documentWith(
	blocks: DocumentV1Input['sections'][number]['blocks'],
	scales?: Scales
): DocumentV1Input {
	return {
		version: 1,
		title: 'Rich Editor Fixture',
		scales,
		sections: [{ id: 'fixture', title: 'Fixture', blocks }]
	};
}

describe('CalloutBlockEditor body runs', () => {
	it('toggles a bold mark on the body as a schema run, never HTML, without leaking to other runs', async () => {
		const block: CalloutBlock = $state({
			type: 'callout',
			id: 'note',
			tone: 'info',
			body: [[{ text: 'Heads ' }, { text: 'up' }]]
		});
		const onEdit = vi.fn();
		const { getByLabelText } = render(CalloutBlockEditor, { block, onEdit });

		await getByLabelText('Callout body paragraph 1, run 2 Bold').click();

		// Only run 2 gained the mark; run 1 is untouched (no flatten, no leak).
		expect(block.body[0]).toEqual([{ text: 'Heads ' }, { text: 'up', bold: true }]);
		// The marked run is a valid schema run (the mark vocabulary, not injected HTML).
		expect(validateDocument(documentWith([block])).ok).toBe(true);
		expect(onEdit).toHaveBeenCalled();
	});

	it('stores HTML-looking run text as a literal string (renderer-purity holds)', async () => {
		const block: CalloutBlock = $state({
			type: 'callout',
			id: 'note',
			tone: 'warning',
			body: [[{ text: '' }]]
		});
		const { getByLabelText } = render(CalloutBlockEditor, { block, onEdit: vi.fn() });

		await getByLabelText('Callout body paragraph 1, run 1 text').fill('<b>not bold</b>');

		expect(block.body[0][0]).toEqual({ text: '<b>not bold</b>' });
	});
});

describe('ListBlockEditor description', () => {
	it('adds an optional description and edits it as inline runs', async () => {
		const block: ListBlock = $state({
			type: 'list',
			id: 'steps',
			ordered: true,
			items: [{ term: 'First step' }]
		});
		const { getByRole, getByLabelText } = render(ListBlockEditor, { block, onEdit: vi.fn() });

		await getByRole('button', { name: 'Add description to item 1' }).click();
		await getByLabelText('Item 1 description paragraph 1, run 1 text').fill('Do the thing');

		expect(block.items[0].description).toEqual([[{ text: 'Do the thing' }]]);
		expect(validateDocument(documentWith([block])).ok).toBe(true);
	});

	it('removes the whole description as one action, keeping the term', async () => {
		const block: ListBlock = $state({
			type: 'list',
			id: 'steps',
			ordered: false,
			items: [{ term: 'Keep me', description: [[{ text: 'drop me' }]] }]
		});
		const { getByRole } = render(ListBlockEditor, { block, onEdit: vi.fn() });

		await getByRole('button', { name: 'Remove item 1 description', exact: true }).click();

		expect('description' in block.items[0]).toBe(false);
		expect(block.items[0].term).toBe('Keep me');
	});
});

describe('TimelineBlockEditor', () => {
	it('picks the status scale and entry from the declared scales', async () => {
		const block: TimelineBlock = $state({
			type: 'timeline',
			id: 'roadmap',
			milestones: [{ label: 'Kickoff', status: { scaleRef: '', entry: '' } }]
		});
		const { getByLabelText } = render(TimelineBlockEditor, {
			block,
			scales: SCALES,
			onEdit: vi.fn()
		});

		await getByLabelText('Milestone 1 status scale').selectOptions('severity');
		// The entry select now offers that scale's entries; pick one.
		await getByLabelText('Milestone 1 status', { exact: true }).selectOptions('high');

		expect(block.milestones[0].status).toEqual({ scaleRef: 'severity', entry: 'high' });
		expect(validateDocument(documentWith([block], SCALES)).ok).toBe(true);
	});

	it('clears the entry when the scale changes so a stale entry cannot dangle', async () => {
		const block: TimelineBlock = $state({
			type: 'timeline',
			id: 'roadmap',
			milestones: [{ label: 'Kickoff', status: { scaleRef: 'severity', entry: 'high' } }]
		});
		const { getByLabelText } = render(TimelineBlockEditor, {
			block,
			scales: SCALES,
			onEdit: vi.fn()
		});

		await getByLabelText('Milestone 1 status scale').selectOptions('sources');

		// The entry reset to empty (the old 'high' is not in 'sources'), so no dangling ref.
		expect(block.milestones[0].status).toEqual({ scaleRef: 'sources', entry: '' });
	});

	it('reorders milestones with the move-down control', async () => {
		const block: TimelineBlock = $state({
			type: 'timeline',
			id: 'roadmap',
			milestones: [
				{ label: 'First', status: { scaleRef: 'severity', entry: 'high' } },
				{ label: 'Second', status: { scaleRef: 'severity', entry: 'low' } }
			]
		});
		const { getByRole } = render(TimelineBlockEditor, { block, scales: SCALES, onEdit: vi.fn() });

		await getByRole('button', { name: 'Move milestone 1 down' }).click();

		expect(block.milestones.map((milestone) => milestone.label)).toEqual(['Second', 'First']);
	});

	it('edits the detail as inline runs through the shared editor', async () => {
		const block: TimelineBlock = $state({
			type: 'timeline',
			id: 'roadmap',
			milestones: [{ label: 'Kickoff', status: { scaleRef: 'severity', entry: 'high' } }]
		});
		const { getByRole, getByLabelText } = render(TimelineBlockEditor, {
			block,
			scales: SCALES,
			onEdit: vi.fn()
		});

		await getByRole('button', { name: 'Add detail to milestone 1' }).click();
		await getByLabelText('Milestone 1 detail paragraph 1, run 1 text').fill('Slipped a week');

		expect(block.milestones[0].detail).toEqual([[{ text: 'Slipped a week' }]]);
	});
});

describe('ComparisonMatrixBlockEditor', () => {
	function matrixBlock(): ComparisonMatrixBlock {
		return {
			type: 'comparison-matrix',
			id: 'coverage',
			severityScale: 'severity',
			sourceScale: 'sources',
			findings: [
				{
					category: 'Access',
					label: 'Weak policy',
					severity: 'high',
					sources: {},
					treatment: { before: 'a', after: 'b', status: 'action' },
					// The Epic 11 internal-link twin: the editor never surfaces it, so it must
					// survive every other edit untouched.
					linkTo: 'details'
				},
				{
					category: 'Network',
					label: 'Open port',
					severity: 'critical',
					sources: {},
					treatment: { before: 'c', after: 'd', status: 'deferred' }
				}
			]
		};
	}

	it('picks the severity from the declared severity scale entries', async () => {
		const block: ComparisonMatrixBlock = $state(matrixBlock());
		const { getByLabelText } = render(ComparisonMatrixBlockEditor, {
			block,
			scales: SCALES,
			onEdit: vi.fn()
		});

		await getByLabelText('Finding 1 severity').selectOptions('low');

		expect(block.findings[0].severity).toBe('low');
	});

	it('reorders findings with the move-down control, preserving the Epic 11 linkTo', async () => {
		const block: ComparisonMatrixBlock = $state(matrixBlock());
		const { getByRole } = render(ComparisonMatrixBlockEditor, {
			block,
			scales: SCALES,
			onEdit: vi.fn()
		});

		await getByRole('button', { name: 'Move finding 1 down' }).click();

		expect(block.findings.map((finding) => finding.label)).toEqual(['Open port', 'Weak policy']);
		// The moved finding kept its linkTo - the editor mutates findings in place and
		// never touches the field it does not surface.
		expect(block.findings[1].linkTo).toBe('details');
	});

	it('sets a per-source cell state keyed by a sources-scale entry', async () => {
		const block: ComparisonMatrixBlock = $state(matrixBlock());
		const { getByLabelText } = render(ComparisonMatrixBlockEditor, {
			block,
			scales: SCALES,
			onEdit: vi.fn()
		});

		await getByLabelText('Finding 1 source SIEM state').selectOptions('found');

		expect(block.findings[0].sources.siem).toEqual({ state: 'found' });
	});
});

describe('scale-driven ref pickers surface a dangling ref through validation', () => {
	it('a legend scaleRef that names no declared scale is the cross-reference 422', () => {
		// The editor only offers declared scales, but a document loaded with a dangling
		// ref (or a scale later removed) is the actionable cross-reference error naming
		// the offending ref - the FR2 parity the editor relies on.
		const block: LegendBlock = { type: 'legend', id: 'key', scaleRef: 'ghost' };
		const result = validateDocument(documentWith([block], SCALES));

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.map((error) => error.path)).toContain('sections[0].blocks[0].scaleRef');
		}
	});

	it('offers only the declared scales in the legend select', async () => {
		const block: LegendBlock = $state({ type: 'legend', id: 'key', scaleRef: '' });
		const { getByLabelText } = render(LegendBlockEditor, {
			block,
			scales: SCALES,
			onEdit: vi.fn()
		});

		await getByLabelText('Legend scale').selectOptions('sources');

		expect(block.scaleRef).toBe('sources');
	});

	it('a chip-cluster entry not in the referenced scale is the cross-reference 422', () => {
		const block: ChipClusterBlock = {
			type: 'chip-cluster',
			id: 'chips',
			scaleRef: 'severity',
			entries: ['ghost']
		};
		const result = validateDocument(documentWith([block], SCALES));

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.map((error) => error.path)).toContain(
				'sections[0].blocks[0].entries[0]'
			);
		}
	});

	it('picks a chip entry from the referenced scale entries', async () => {
		const block: ChipClusterBlock = $state({
			type: 'chip-cluster',
			id: 'chips',
			scaleRef: 'severity',
			entries: ['']
		});
		const { getByLabelText } = render(ChipClusterBlockEditor, {
			block,
			scales: SCALES,
			onEdit: vi.fn()
		});

		await getByLabelText('Chip 1 entry').selectOptions('critical');

		expect(block.entries[0]).toBe('critical');
	});

	it('picks the set-membership source from the document comparison-matrix blocks', async () => {
		const block: SetMembershipBlock = $state({
			type: 'set-membership',
			id: 'upset',
			sourceBlockId: ''
		});
		const matrixBlocks = [{ id: 'coverage', label: 'Findings - coverage' }];
		const { getByLabelText } = render(SetMembershipBlockEditor, {
			block,
			matrixBlocks,
			onEdit: vi.fn()
		});

		await getByLabelText('Source comparison matrix').selectOptions('coverage');

		expect(block.sourceBlockId).toBe('coverage');
	});

	it('a set-membership sourceBlockId naming no comparison-matrix block is the cross-reference 422', () => {
		const block: SetMembershipBlock = {
			type: 'set-membership',
			id: 'upset',
			sourceBlockId: 'ghost'
		};
		const result = validateDocument(documentWith([block], SCALES));

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.map((error) => error.path)).toContain(
				'sections[0].blocks[0].sourceBlockId'
			);
		}
	});
});
