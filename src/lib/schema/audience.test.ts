import { describe, expect, it } from 'vitest';
import {
	audiencesAttr,
	DEFAULT_AUDIENCE,
	hasAudienceTags,
	isVisibleAtLevel,
	levelRevealingDetail
} from './audience.ts';

describe('isVisibleAtLevel', () => {
	it('shows an untagged element at every level', () => {
		expect(isVisibleAtLevel(undefined, 'summary')).toBe(true);
		expect(isVisibleAtLevel(undefined, 'full')).toBe(true);
		expect(isVisibleAtLevel(undefined, 'technical')).toBe(true);
	});

	it('treats an empty tag set as untagged (visible everywhere)', () => {
		expect(isVisibleAtLevel([], 'summary')).toBe(true);
		expect(isVisibleAtLevel([], 'technical')).toBe(true);
	});

	it('shows a tagged element only at the levels it lists', () => {
		expect(isVisibleAtLevel(['technical'], 'technical')).toBe(true);
		expect(isVisibleAtLevel(['technical'], 'summary')).toBe(false);
		expect(isVisibleAtLevel(['technical'], 'full')).toBe(false);
	});

	it('honours a multi-level tag set', () => {
		expect(isVisibleAtLevel(['summary', 'full'], 'summary')).toBe(true);
		expect(isVisibleAtLevel(['summary', 'full'], 'full')).toBe(true);
		expect(isVisibleAtLevel(['summary', 'full'], 'technical')).toBe(false);
	});

	it('defaults the reading level to full (FR28)', () => {
		expect(DEFAULT_AUDIENCE).toBe('full');
	});
});

describe('hasAudienceTags', () => {
	it('is false for an untagged document', () => {
		expect(hasAudienceTags([{ blocks: [{}, {}] }, { blocks: [{ audiences: [] }] }])).toBe(false);
	});

	it('is true when a block carries a tag', () => {
		expect(hasAudienceTags([{ blocks: [{ audiences: ['technical'] }] }])).toBe(true);
	});

	it('is true when a section carries a tag even with untagged blocks', () => {
		expect(hasAudienceTags([{ audiences: ['summary'], blocks: [{}] }])).toBe(true);
	});

	it('tolerates missing sections and missing blocks', () => {
		expect(hasAudienceTags(undefined)).toBe(false);
		expect(hasAudienceTags([{}])).toBe(false);
	});
});

describe('levelRevealingDetail', () => {
	it('keeps the current level for an untagged detail (visible everywhere)', () => {
		const section = { blocks: [{}, {}] };
		expect(levelRevealingDetail(section, 'full')).toBe('full');
		expect(levelRevealingDetail(section, 'summary')).toBe('summary');
	});

	it('keeps the current level when the section and a block are already visible', () => {
		const section = {
			audiences: ['summary', 'full', 'technical'] as const,
			blocks: [{ audiences: ['full'] as const }]
		};
		expect(levelRevealingDetail(section, 'full')).toBe('full');
	});

	it('promotes when a section-level tag hides the whole detail at the current level', () => {
		// A `['technical']` section is hidden at `full`; promote to the level that
		// reveals it (the host is otherwise `display: none` even when targeted).
		const section = { audiences: ['technical'] as const, blocks: [{}] };
		expect(levelRevealingDetail(section, 'full')).toBe('technical');
	});

	it('promotes when the section is visible but its only block is tagged out (empty box)', () => {
		// Untagged section, sole block `['technical']`: at `full` the host shows but
		// its content is hidden. Promotion must raise the level to reveal the block.
		const section = { blocks: [{ audiences: ['technical'] as const }] };
		expect(levelRevealingDetail(section, 'full')).toBe('technical');
	});

	it('treats a section with no visible block as needing promotion even if the frame shows', () => {
		const section = {
			audiences: ['summary', 'full'] as const,
			blocks: [{ audiences: ['summary'] as const }]
		};
		// At `full` the frame shows but no block does; `summary` reveals both.
		expect(levelRevealingDetail(section, 'full')).toBe('summary');
	});

	it('returns the first canonical level that reveals both frame and a block', () => {
		// AUDIENCES order is summary, full, technical; the block is visible at summary
		// and full, so the earliest revealing level wins.
		const section = { blocks: [{ audiences: ['summary', 'full'] as const }] };
		expect(levelRevealingDetail(section, 'technical')).toBe('summary');
	});

	it('falls back to the current level when nothing can reveal the content', () => {
		// An over-constrained authoring mistake: the section excludes the only level
		// its block allows, so no level reveals both. Leave the reader where they are.
		const section = {
			audiences: ['summary'] as const,
			blocks: [{ audiences: ['technical'] as const }]
		};
		expect(levelRevealingDetail(section, 'full')).toBe('full');
	});
});

describe('audiencesAttr', () => {
	it('returns undefined for an untagged element so no rule matches it', () => {
		expect(audiencesAttr(undefined)).toBeUndefined();
		expect(audiencesAttr([])).toBeUndefined();
	});

	it('serializes a tag set in canonical order, space-separated', () => {
		expect(audiencesAttr(['technical', 'summary'])).toBe('summary technical');
		expect(audiencesAttr(['full'])).toBe('full');
	});
});
