import { describe, expect, it } from 'vitest';
import { audiencesAttr, DEFAULT_AUDIENCE, hasAudienceTags, isVisibleAtLevel } from './audience.ts';

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
