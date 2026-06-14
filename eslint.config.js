import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		// Architecture rule: schema modules are pure data definitions. They must
		// not depend on server-only code or UI components.
		files: ['src/lib/schema/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['$lib/server', '$lib/server/*', '**/server/**'],
							message:
								'Architecture rule: src/lib/schema must not import server-only code ($lib/server).'
						},
						{
							group: ['$lib/ui', '$lib/ui/*', '**/ui/**'],
							message: 'Architecture rule: src/lib/schema must not import UI components ($lib/ui).'
						}
					]
				}
			]
		}
	},
	{
		// Architecture rule: renderers stay pure. They must not depend on
		// server-only code so output is reproducible from input alone.
		files: ['src/lib/render/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['$lib/server', '$lib/server/*', '**/server/**'],
							message:
								'Architecture rule: src/lib/render must not import server-only code ($lib/server); renderers stay pure.'
						}
					]
				}
			]
		}
	},
	{
		// Architecture rule: the render boundary NEVER injects raw HTML. Authored
		// values are untrusted document content (NFR14), so every renderer emits
		// them through Svelte text/attribute interpolation, which escapes. `{@html}`
		// would bypass that escaping and open a stored-XSS hole on the reader path.
		// `svelte/no-at-html-tags` (svelte.configs.recommended) already errors on
		// `{@html}` in every .svelte file; re-asserting it here scoped to the render
		// tree, with the architecture rationale, makes the ban a deliberate boundary
		// contract that survives any future relaxation of the global rule rather than
		// resting on review - mirroring the $lib/server import ban above.
		files: ['src/lib/render/**/*.svelte'],
		rules: {
			'svelte/no-at-html-tags': 'error'
		}
	}
);
