/**
 * Render tier public surface (D11/D13). Pure: these modules consume a
 * validated (or snapshot) document plus theme tokens only - no server imports,
 * no services (renderer purity boundary, enforced by the ESLint guard).
 * Reused identically by the reader SSR route and the workspace LivePreview.
 */
export { default as Report } from './Report.svelte';
export { toReportView, toPreviewView } from './document-view.ts';
export type { ReportView, SectionView, BlockView, TocEntry } from './document-view.ts';
export {
	resolveTheme,
	BUILT_IN_THEMES,
	THEME_PALETTES,
	contrastRatio,
	AAA_CONTRAST,
	AA_CONTRAST
} from './theme/index.ts';
export type { ThemeName, ThemePalette } from './theme/index.ts';
