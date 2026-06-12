/**
 * Pure UpSet (set-membership) geometry for SetMembershipBlock. The renderer is
 * SSR-only (zero hydration, the architecture D12 fallback chosen by measurement),
 * so the intersection rows are derived here as plain data + pixel coordinates and
 * emitted as a static <svg>. Only d3-scale and d3-shape are used: math, no DOM, no
 * component runtime, so nothing UpSet-related ships to the reader (NFR3).
 *
 * The output carries only the membership booleans, the dot/line geometry and the
 * finding pill descriptors (severity + short label) the SVG needs - never the raw
 * finding `text`/`treatment`, honoring "do not ship raw datasets beyond what the
 * SVG needs".
 */
import { scalePoint } from 'd3-scale';
import { line } from 'd3-shape';
import type { Finding, ScaleEntry, SourceState } from '$lib/schema';

/**
 * THE isolated membership predicate (Story 7.4 DECIDED SEMANTICS). A source is in
 * a finding's intersection set when it FOUND the finding: the conventional
 * coverage UpSet ("which sources detected this finding"). `missing` and `none`
 * (and an absent record key, which renders as `none`) are NOT in the set.
 *
 * Keep this the SINGLE place the predicate lives: flipping the product to
 * "found OR missing" (every source that had an opinion) is a one-line change here
 * (`state === 'found' || state === 'missing'`), with no other edit anywhere.
 */
export function isInMembershipSet(state: SourceState | undefined): boolean {
	return state === 'found';
}

/** A finding rendered as a pill beside its intersection row. */
export interface FindingPill {
	/** The short label: the finding's `tag`, falling back to its `label`. */
	text: string;
	/** The severity-scale entry key, for the pill colour (resolved at render). */
	severity: string;
}

/** One present intersection: a distinct set of sources that found its findings. */
export interface IntersectionRow {
	/** Membership aligned to the sources-scale entry order: true = source in the set. */
	membership: boolean[];
	/** The findings grouped into this intersection, as pill descriptors. */
	findingPills: FindingPill[];
	/** The finding count (the bar length in a full UpSet; the primary sort key). */
	count: number;
	/** The number of sources in the set (the membership-size tiebreak). */
	membershipSize: number;
	/** Dot centres in pixel space, one per source column. */
	dots: Array<{ cx: number; cy: number; filled: boolean }>;
	/** The connector path through the filled dots, or undefined when 0 or 1 filled. */
	linePath?: string;
	/** A words summary of this intersection for the accessible alternative. */
	summary: string;
}

export interface UpSetGeometry {
	viewBox: { width: number; height: number };
	/** Source labels with their dot column x-position, in scale order. */
	sources: Array<{ key: string; label: string; cx: number }>;
	rows: IntersectionRow[];
	/** Per-row band height, for the pill column row tracks in the component. */
	rowHeight: number;
	/** Top inset before row 0, so the pill column aligns its first group to it. */
	marginTop: number;
	/** Bottom inset (under the last row) reserved for the source labels. */
	marginBottom: number;
	dotRadius: number;
}

const VIEW_WIDTH = 720;
const MARGIN = { top: 16, right: 24, bottom: 16, left: 160 };
const ROW_HEIGHT = 34;
const DOT_RADIUS = 6;

/** The pill text for a finding: its short `tag`, else its full `label`. */
function pillText(finding: Pick<Finding, 'tag' | 'label'>): string {
	return finding.tag ?? finding.label;
}

/**
 * The canonical membership key for a finding: the sorted (scale-order) list of
 * source keys where the finding was found, joined into a stable string. Two
 * findings with the same key share an intersection. An empty key is the empty
 * intersection (no source found the finding).
 */
function membershipKey(finding: Finding, sourceOrder: readonly string[]): string {
	return sourceOrder.filter((key) => isInMembershipSet(finding.sources[key]?.state)).join('|');
}

/**
 * Builds the words summary for an intersection ("Found by SIEM and EDR: pwd, net"
 * or "Found by no source: orphan"), so a screen reader gets the data without the
 * dot pattern (NFR14 / AAA). Generalized: no domain vocabulary in the code.
 */
function summarize(memberLabels: string[], pills: FindingPill[]): string {
	const who =
		memberLabels.length === 0 ? 'Found by no source' : `Found by ${joinLabels(memberLabels)}`;
	return `${who}: ${pills.map((pill) => pill.text).join(', ')}.`;
}

/** Joins labels with commas and a trailing "and" ("A", "A and B", "A, B and C"). */
function joinLabels(labels: string[]): string {
	if (labels.length === 1) return labels[0];
	if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
	return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * Derives the UpSet geometry from a comparison-matrix's findings and the
 * sources-scale entries (the column order). Pure and isomorphic.
 *
 * Grouping: findings are grouped by their canonical membership key (the set of
 * sources that FOUND them, per {@link isInMembershipSet}). One row per PRESENT
 * intersection. The empty-set group (findings no source found) is emitted as an
 * explicit "(none)" row - so orphaned findings are never silently dropped beside
 * real coverage - BUT only when at least one present (non-empty) intersection
 * also exists; that row carries no filled dots and no connector, just its pills
 * and a "Found by no source" summary. When EVERY finding is empty-set (or there
 * are no findings), there is no coverage to chart: `rows` is empty and the
 * component renders the neutral empty state.
 *
 * Ordering (conventional UpSet, deterministic): descending finding count, then
 * descending membership size, then the canonical key ascending (so equal-count,
 * equal-size rows have a stable lexical order). The empty-set row has membership
 * size 0, so it sorts after any non-empty intersection of equal count.
 */
export function computeUpSetGeometry(
	findings: readonly Finding[],
	sourceEntries: readonly ScaleEntry[]
): UpSetGeometry {
	const sourceOrder = sourceEntries.map((entry) => entry.key);

	const groups = new Map<string, Finding[]>();
	for (const finding of findings) {
		const key = membershipKey(finding, sourceOrder);
		const group = groups.get(key);
		if (group) group.push(finding);
		else groups.set(key, [finding]);
	}

	const xScale = scalePoint<string>()
		.domain(sourceOrder)
		.range([MARGIN.left, Math.max(MARGIN.left, VIEW_WIDTH - MARGIN.right)])
		.padding(0.5);

	const sources = sourceEntries.map((entry) => ({
		key: entry.key,
		label: entry.label,
		cx: xScale(entry.key) ?? MARGIN.left
	}));

	// The empty-set group (findings no source found) is emitted as an explicit
	// "(none)" row ONLY when at least one present (non-empty) intersection exists,
	// so orphaned findings are not silently dropped beside real coverage. When the
	// empty set is the ONLY group (every finding is all none/missing), there is no
	// coverage to chart: drop it so `rows` is empty and the component shows the
	// neutral empty state rather than a single dotless row.
	const hasPresentIntersection = [...groups.keys()].some((key) => key !== '');
	if (!hasPresentIntersection) {
		groups.delete('');
	}

	const unordered = [...groups.entries()].map(([key, groupFindings]) => {
		const memberKeys = key === '' ? [] : key.split('|');
		const memberSet = new Set(memberKeys);
		const membership = sourceOrder.map((sourceKey) => memberSet.has(sourceKey));
		const findingPills = groupFindings.map((finding) => ({
			text: pillText(finding),
			severity: finding.severity
		}));
		const memberLabels = sourceEntries
			.filter((entry) => memberSet.has(entry.key))
			.map((entry) => entry.label);
		return {
			key,
			membership,
			membershipSize: memberKeys.length,
			findingPills,
			count: groupFindings.length,
			memberLabels
		};
	});

	unordered.sort((a, b) => {
		if (b.count !== a.count) return b.count - a.count;
		if (b.membershipSize !== a.membershipSize) return b.membershipSize - a.membershipSize;
		return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
	});

	const lineGen = line<{ cx: number; cy: number }>()
		.x((d) => d.cx)
		.y((d) => d.cy);

	const rows: IntersectionRow[] = unordered.map((row, rowIndex) => {
		const cy = MARGIN.top + rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
		const dots = sources.map((source, columnIndex) => ({
			cx: source.cx,
			cy,
			filled: row.membership[columnIndex]
		}));
		const filledDots = dots.filter((dot) => dot.filled);
		const linePath = filledDots.length >= 2 ? (lineGen(filledDots) ?? undefined) : undefined;
		return {
			membership: row.membership,
			findingPills: row.findingPills,
			count: row.count,
			membershipSize: row.membershipSize,
			dots,
			linePath,
			summary: summarize(row.memberLabels, row.findingPills)
		};
	});

	return {
		viewBox: { width: VIEW_WIDTH, height: MARGIN.top + rows.length * ROW_HEIGHT + MARGIN.bottom },
		sources,
		rows,
		rowHeight: ROW_HEIGHT,
		marginTop: MARGIN.top,
		marginBottom: MARGIN.bottom,
		dotRadius: DOT_RADIUS
	};
}
