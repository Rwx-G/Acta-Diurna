import { describe, expect, it } from 'vitest';
import { getBrick, BRICKS } from '$lib/bricks';
import { AppError } from '$lib/server/problem';
import { saveSkeleton } from './skeletons.ts';

function draftFrom(...brickIds: string[]) {
	return {
		version: 1 as const,
		title: 'My skeleton',
		sections: brickIds.map((id) => getBrick(id)!.factory())
	};
}

describe('saveSkeleton', () => {
	it('validates and returns a composed structure with its name', () => {
		const draft = draftFrom('cover', 'dataTable');
		const saved = saveSkeleton(draft);
		expect(saved.name).toBe('My skeleton');
		expect(saved.structure.sections).toHaveLength(2);
	});

	it('accepts a full library assembly', () => {
		const draft = {
			version: 1 as const,
			title: 'Everything',
			sections: BRICKS.map((brick) => brick.factory())
		};
		expect(() => saveSkeleton(draft)).not.toThrow();
	});

	it('blocks an empty section with a 422 carrying the error at the section path', () => {
		const draft = draftFrom('cover');
		draft.sections[0].blocks = [];
		try {
			saveSkeleton(draft);
			expect.unreachable('saveSkeleton should have thrown');
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(AppError);
			const error = thrown as AppError;
			expect(error.status).toBe(422);
			expect(error.errors?.[0].path).toMatch(/^sections\[0\]\.blocks$/);
			expect(error.errors?.[0].message).toContain('at least one block');
		}
	});

	it('blocks an empty title with a 422', () => {
		const draft = draftFrom('cover');
		draft.title = '';
		try {
			saveSkeleton(draft);
			expect.unreachable('saveSkeleton should have thrown');
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(AppError);
			expect((thrown as AppError).status).toBe(422);
		}
	});
});
