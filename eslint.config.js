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
	}
);
