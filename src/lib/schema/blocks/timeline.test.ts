import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateDocument } from '../errors.ts';
import {
	MAX_MILESTONE_DETAIL_PARAGRAPHS,
	MAX_MILESTONES,
	timelineBlockSchema,
	type TimelineBlock
} from './timeline.ts';

function validBlock(overrides: Partial<TimelineBlock> = {}): TimelineBlock {
	return {
		type: 'timeline',
		id: 'roadmap',
		milestones: [
			{
				label: 'Kickoff',
				date: 'Q1 2026',
				detail: [[{ text: 'Scope and team confirmed.' }]],
				status: { scaleRef: 'status', entry: 'done' }
			},
			{ label: 'Build', status: { scaleRef: 'status', entry: 'in-progress' } },
			{ label: 'Launch', status: { scaleRef: 'status', entry: 'blocked' } }
		],
		...overrides
	};
}

/** A document carrying a status scale and the given timeline block. */
function documentWithTimeline(block: unknown, withScales = true): unknown {
	return {
		version: 1,
		title: 'Roadmap',
		...(withScales
			? {
					scales: [
						{
							key: 'status',
							label: 'Status',
							kind: 'nominal',
							entries: [
								{ key: 'done', label: 'Done' },
								{ key: 'in-progress', label: 'In progress' },
								{ key: 'blocked', label: 'Blocked' }
							]
						}
					]
				}
			: {}),
		sections: [{ id: 'overview', title: 'Overview', blocks: [block] }]
	};
}

describe('timelineBlockSchema - valid shapes', () => {
	it('parses a full timeline block with type inference', () => {
		const result = timelineBlockSchema.safeParse(validBlock());
		expect(result.success).toBe(true);
		if (result.success) {
			expectTypeOf(result.data).toEqualTypeOf<TimelineBlock>();
			expect(result.data.milestones).toHaveLength(3);
			expect(result.data.milestones[0].status).toEqual({ scaleRef: 'status', entry: 'done' });
		}
	});

	it('accepts a milestone with no date and no detail (only label + status)', () => {
		const result = timelineBlockSchema.safeParse(
			validBlock({
				milestones: [{ label: 'Just a label', status: { scaleRef: 'status', entry: 'done' } }]
			})
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.milestones[0].date).toBeUndefined();
			expect(result.data.milestones[0].detail).toBeUndefined();
		}
	});

	it('accepts a detail with inline-run formatting (the text rich-text vocabulary)', () => {
		const result = timelineBlockSchema.safeParse(
			validBlock({
				milestones: [
					{
						label: 'Ship',
						detail: [[{ text: 'Run ' }, { text: 'pnpm build', code: true }, { text: ' first.' }]],
						status: { scaleRef: 'status', entry: 'done' }
					}
				]
			})
		);
		expect(result.success).toBe(true);
	});

	it('accepts an optional title and audiences', () => {
		const result = timelineBlockSchema.safeParse(
			validBlock({ title: 'Delivery plan', audiences: ['technical'] })
		);
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.title).toBe('Delivery plan');
	});

	it('assembles into a valid document when the scale and every status entry resolve', () => {
		expect(validateDocument(documentWithTimeline(validBlock())).ok).toBe(true);
	});

	it('accepts exactly MAX_MILESTONES milestones', () => {
		const milestones = Array.from({ length: MAX_MILESTONES }, (_, index) => ({
			label: `Milestone ${index}`,
			status: { scaleRef: 'status', entry: 'done' }
		}));
		expect(timelineBlockSchema.safeParse(validBlock({ milestones })).success).toBe(true);
	});
});

describe('timelineBlockSchema - malformed shapes', () => {
	it('rejects an empty milestones array', () => {
		expect(timelineBlockSchema.safeParse(validBlock({ milestones: [] })).success).toBe(false);
	});

	it('rejects a milestone with an empty label', () => {
		expect(
			timelineBlockSchema.safeParse(
				validBlock({ milestones: [{ label: '', status: { scaleRef: 'status', entry: 'done' } }] })
			).success
		).toBe(false);
	});

	it('rejects a milestone label over 300 characters', () => {
		expect(
			timelineBlockSchema.safeParse(
				validBlock({
					milestones: [{ label: 'x'.repeat(301), status: { scaleRef: 'status', entry: 'done' } }]
				})
			).success
		).toBe(false);
	});

	it('rejects a missing status', () => {
		expect(
			timelineBlockSchema.safeParse(validBlock({ milestones: [{ label: 'No status' } as never] }))
				.success
		).toBe(false);
	});

	it('rejects a non-slug status scaleRef', () => {
		expect(
			timelineBlockSchema.safeParse(
				validBlock({
					milestones: [{ label: 'Bad', status: { scaleRef: 'Not A Slug', entry: 'done' } }]
				})
			).success
		).toBe(false);
	});

	it('rejects a date over 120 characters', () => {
		expect(
			timelineBlockSchema.safeParse(
				validBlock({
					milestones: [
						{ label: 'd', date: 'x'.repeat(121), status: { scaleRef: 'status', entry: 'done' } }
					]
				})
			).success
		).toBe(false);
	});

	it('rejects an empty detail array', () => {
		expect(
			timelineBlockSchema.safeParse(
				validBlock({
					milestones: [{ label: 'd', detail: [], status: { scaleRef: 'status', entry: 'done' } }]
				})
			).success
		).toBe(false);
	});

	it('rejects more than MAX_MILESTONE_DETAIL_PARAGRAPHS detail paragraphs', () => {
		const detail = Array.from({ length: MAX_MILESTONE_DETAIL_PARAGRAPHS + 1 }, () => [
			{ text: 'p' }
		]);
		expect(
			timelineBlockSchema.safeParse(
				validBlock({
					milestones: [{ label: 'd', detail, status: { scaleRef: 'status', entry: 'done' } }]
				})
			).success
		).toBe(false);
	});

	it('rejects more than MAX_MILESTONES milestones', () => {
		const milestones = Array.from({ length: MAX_MILESTONES + 1 }, (_, index) => ({
			label: `Milestone ${index}`,
			status: { scaleRef: 'status', entry: 'done' }
		}));
		expect(timelineBlockSchema.safeParse(validBlock({ milestones })).success).toBe(false);
	});

	it('rejects a title over 200 characters', () => {
		expect(timelineBlockSchema.safeParse(validBlock({ title: 'x'.repeat(201) })).success).toBe(
			false
		);
	});
});

describe('timeline block - cross reference (FR2)', () => {
	it('passes when the scale and every status entry resolve', () => {
		expect(validateDocument(documentWithTimeline(validBlock())).ok).toBe(true);
	});

	it('flags an unknown status scaleRef, naming the offending milestone', () => {
		const result = validateDocument(
			documentWithTimeline(
				validBlock({
					milestones: [{ label: 'Kickoff', status: { scaleRef: 'ghost', entry: 'done' } }]
				})
			)
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.path.endsWith('status.scaleRef'));
			expect(issue?.path).toBe('sections[0].blocks[0].milestones[0].status.scaleRef');
			expect(issue?.message).toContain('ghost');
			expect(issue?.message).toContain('Kickoff');
		}
	});

	it('flags an unknown status entry, naming the offending milestone and value', () => {
		const result = validateDocument(
			documentWithTimeline(
				validBlock({
					milestones: [{ label: 'Launch', status: { scaleRef: 'status', entry: 'ghost' } }]
				})
			)
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.path.endsWith('status.entry'));
			expect(issue?.path).toBe('sections[0].blocks[0].milestones[0].status.entry');
			expect(issue?.message).toContain('ghost');
			expect(issue?.message).toContain('Launch');
		}
	});

	it('flags a dangling reference when the document declares no scales', () => {
		const result = validateDocument(documentWithTimeline(validBlock(), false));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.some((e) => e.path.endsWith('status.scaleRef'))).toBe(true);
		}
	});
});

describe('timeline block - additivity', () => {
	it('does not affect a v1 document with no timeline block', () => {
		const result = validateDocument({
			version: 1,
			title: 'Plain',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [{ type: 'text', id: 't', paragraphs: [[{ text: 'x' }]] }]
				}
			]
		});
		expect(result.ok).toBe(true);
	});
});
