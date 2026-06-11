import type { DocumentV1Input } from '../versions/v1.ts';

/** The smallest valid Acta Diurna document. */
export const minimalDocument: DocumentV1Input = {
	version: 1,
	title: 'Minimal Report',
	sections: [
		{
			id: 'overview',
			title: 'Overview',
			blocks: [
				{
					type: 'text',
					id: 'introduction',
					paragraphs: [[{ text: 'The smallest valid Acta Diurna document.' }]]
				}
			]
		}
	]
};
