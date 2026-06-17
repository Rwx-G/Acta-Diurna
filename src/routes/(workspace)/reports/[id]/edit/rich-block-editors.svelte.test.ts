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

describe('ParagraphsEditor run link guard (Epic 11 linkTo mutual exclusion)', () => {
	it('disables the URL input on a run carrying an internal linkTo, and surfaces a note', async () => {
		// A run links internally (`linkTo`) OR externally (`link.href`), never both - the
		// schema refines them mutually exclusive. The editor preserves but does not surface
		// `linkTo`, so the URL input must be disabled on such a run: otherwise typing a URL
		// authors a 422 the editor cannot then clear.
		const block: CalloutBlock = $state({
			type: 'callout',
			id: 'note',
			tone: 'info',
			body: [[{ text: 'See the appendix', linkTo: 'fixture' }]]
		});
		const { getByLabelText, getByText } = render(CalloutBlockEditor, { block, onEdit: vi.fn() });

		const urlInput = getByLabelText(
			'Callout body paragraph 1, run 1 link URL'
		).element() as HTMLInputElement;

		expect(urlInput.disabled).toBe(true);
		await expect.element(getByText('Internal link set')).toBeInTheDocument();
		// The run keeps its linkTo and never gains a link (the document stays valid).
		expect(block.body[0][0]).toEqual({ text: 'See the appendix', linkTo: 'fixture' });
		expect(validateDocument(documentWith([block])).ok).toBe(true);
	});

	it('leaves the URL input enabled on a plain run (no linkTo)', () => {
		const block: CalloutBlock = $state({
			type: 'callout',
			id: 'note',
			tone: 'info',
			body: [[{ text: 'Plain run' }]]
		});
		const { getByLabelText } = render(CalloutBlockEditor, { block, onEdit: vi.fn() });

		const urlInput = getByLabelText(
			'Callout body paragraph 1, run 1 link URL'
		).element() as HTMLInputElement;

		expect(urlInput.disabled).toBe(false);
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

	it('marks a finding done via the treatment status', async () => {
		const block: ComparisonMatrixBlock = $state(matrixBlock());
		const { getByLabelText } = render(ComparisonMatrixBlockEditor, {
			block,
			scales: SCALES,
			onEdit: vi.fn()
		});

		await getByLabelText('Finding 1 treatment status').selectOptions('done');

		expect(block.findings[0].treatment.status).toBe('done');
	});

	it('overrides the treatment column labels via the toggle', async () => {
		const block: ComparisonMatrixBlock = $state(matrixBlock());
		const { getByLabelText } = render(ComparisonMatrixBlockEditor, {
			block,
			scales: SCALES,
			onEdit: vi.fn()
		});

		// Off by default: no override on the block.
		expect(block.treatmentLabels).toBeUndefined();

		await getByLabelText('Custom treatment column labels').click();
		// The toggle seeds both labels so the field is never half-filled.
		expect(block.treatmentLabels).toEqual({ before: 'Before', after: 'After' });

		await getByLabelText('Treatment before column label').fill('Current status');
		await getByLabelText('Treatment after column label').fill('Target');
		expect(block.treatmentLabels).toEqual({ before: 'Current status', after: 'Target' });

		// Clearing the toggle drops the override back to the built-in defaults.
		await getByLabelText('Custom treatment column labels').click();
		expect(block.treatmentLabels).toBeUndefined();
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

	it('resets every finding severity when the severity scale changes (no stale ref dangles)', async () => {
		const block: ComparisonMatrixBlock = $state(matrixBlock());
		const { getByLabelText } = render(ComparisonMatrixBlockEditor, {
			block,
			scales: SCALES,
			onEdit: vi.fn()
		});

		// Both findings start with a severity scored against the 'severity' scale.
		expect(block.findings.map((finding) => finding.severity)).toEqual(['high', 'critical']);

		await getByLabelText('Severity scale').selectOptions('sources');

		// Changing the scale clears every severity: the old keys are not entries of the
		// new scale, so keeping them would dangle (invisible until the save 422). Mirrors
		// the timeline reset of `milestone.status.entry` on a scale change.
		expect(block.findings.map((finding) => finding.severity)).toEqual(['', '']);
	});

	it('clears every finding source cell when the sources scale changes', async () => {
		const block: ComparisonMatrixBlock = $state({
			type: 'comparison-matrix',
			id: 'coverage',
			severityScale: 'severity',
			sourceScale: 'sources',
			findings: [
				{
					category: 'Access',
					label: 'Weak policy',
					severity: 'high',
					sources: { siem: { state: 'found' }, edr: { state: 'missing' } },
					treatment: { before: 'a', after: 'b', status: 'action' }
				}
			]
		});
		const { getByLabelText } = render(ComparisonMatrixBlockEditor, {
			block,
			scales: SCALES,
			onEdit: vi.fn()
		});

		await getByLabelText('Sources scale').selectOptions('severity');

		// The cells were keyed by the old sources-scale entries; clearing them on the
		// scale change drops the stale keys that would otherwise dangle.
		expect(block.findings[0].sources).toEqual({});
	});

	it('reuses the existing finding nodes across a reorder (object-keyed each, no remount)', async () => {
		const block: ComparisonMatrixBlock = $state(matrixBlock());
		const { getByLabelText, getByRole } = render(ComparisonMatrixBlockEditor, {
			block,
			scales: SCALES,
			onEdit: vi.fn()
		});

		// Capture the SECOND finding's label DOM node, then move it up. Because the each is
		// keyed by the finding OBJECT (not the index), the swap MOVES this existing node to
		// the new position rather than remounting a fresh subtree there. An index-keyed
		// each would instead recreate the node at index 0 and discard this one, dropping any
		// focus / caret / open child editor inside it - the churn this fix removes.
		const secondLabel = getByLabelText('Finding 2 label').element() as HTMLInputElement;
		expect(secondLabel.value).toBe('Open port');

		await getByRole('button', { name: 'Move finding 2 up' }).click();

		expect(block.findings.map((finding) => finding.label)).toEqual(['Open port', 'Weak policy']);
		// The SAME node now answers to the index-1 -> index-0 accessible name and still
		// holds "Open port": it was moved, not remounted (a remount would leave this
		// detached node out of the document).
		await vi.waitFor(() => {
			expect(secondLabel.getAttribute('aria-label')).toBe('Finding 1 label');
			expect(secondLabel.isConnected).toBe(true);
			expect(getByLabelText('Finding 1 label').element()).toBe(secondLabel);
		});
	});

	it('labels the treatment status options with human text, not the raw enum', async () => {
		const block: ComparisonMatrixBlock = $state(matrixBlock());
		const { getByLabelText } = render(ComparisonMatrixBlockEditor, {
			block,
			scales: SCALES,
			onEdit: vi.fn()
		});

		const select = getByLabelText('Finding 1 treatment status').element() as HTMLSelectElement;
		const optionLabels = Array.from(select.options).map((option) => option.textContent);

		expect(optionLabels).toEqual([
			'Decision required',
			'Action',
			'In progress',
			'Deferred',
			'Done'
		]);
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
