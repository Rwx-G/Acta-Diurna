/**
 * Pure UpSet (set-membership) geometry for SetMembershipBlock. The renderer is
 * SSR-only (zero hydration, the architecture D12 fallback chosen by measurement),
 * so the intersection rows are derived here as plain data + pixel coordinates and
 * emitted as static SVGs. Only d3-scale and d3-shape are used: math, no DOM, no
 * component runtime, so nothing UpSet-related ships to the reader (NFR3).
 *
 * Layout model: each intersection is ONE content-sized layout row. The dot strip
 * is a small per-row mini-SVG of fixed width/height (one dot row), drawn in its
 * OWN small coordinate space, while the pills wrap freely in a sibling cell. The
 * row height is `auto`, so a row with many wrapping pills grows instead of
 * overflowing into its neighbours. The dot x-positions are SHARED across every row
 * (computed once from the source scale), so the source columns stay vertically
 * aligned - the whole point of an UpSet.
 *
 * The output carries only the membership booleans, the dot/line geometry and the
 * finding pill descriptors (severity + short label) the SVG needs - never the raw
 * finding `text`/`treatment`, honoring "do not ship raw datasets beyond what the
 * SVG needs".
 */
import { line } from 'd3-shape';
import type { Finding, ScaleEntry, SourceState, TreatmentStatus } from '$lib/schema';

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
	/** The treatment disposition, so the pill reads action (criticality) / deferred
	 * (grey) / done (green) - the UpSet stays in step with the matrix status tints. */
	treatmentStatus: TreatmentStatus;
}

/** One dot in a row's mini-strip: x in the strip's own coordinate space. */
export interface RowDot {
	cx: number;
	filled: boolean;
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
	/**
	 * Dot centres in the row strip's OWN coordinate space, one per source column.
	 * The `cx` values are identical across every row (shared columns), so the
	 * source columns line up vertically even though each row is a separate SVG.
	 */
	dots: RowDot[];
	/** The connector path through the filled dots, or undefined when 0 or 1 filled. */
	linePath?: string;
	/** A words summary of this intersection for the accessible alternative. */
	summary: string;
}

export interface UpSetGeometry {
	/** Source labels with their dot column x-position, in scale order. */
	sources: Array<{ key: string; label: string; cx: number }>;
	rows: IntersectionRow[];
	/** The shared mini-strip viewport every row's dot SVG uses. */
	strip: { width: number; height: number };
	dotRadius: number;
}

const STRIP_HEIGHT = 28;
const DOT_RADIUS = 6;
// Column spacing ADAPTS to the source labels so the trailing label row never
// overlaps or clips: each column is at least as wide as its label (estimated from
// the character count at the tick font) plus padding, with a floor. The dot
// columns space out to match, keeping every source label legible whatever the
// number or length of sources.
const LABEL_CHAR_WIDTH = 6.5;
const COLUMN_LABEL_PAD = 14;
const MIN_COLUMN_GAP = 44;

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

	// The shared column geometry: each column is wide enough for its source label
	// (estimated from the character count), so the dot x-positions - identical for
	// every row so the source columns line up vertically - also space the trailing
	// labels apart enough to never overlap or clip.
	const columnGap = Math.max(
		MIN_COLUMN_GAP,
		...sourceEntries.map((entry) => entry.label.length * LABEL_CHAR_WIDTH + COLUMN_LABEL_PAD)
	);
	const stripWidth = columnGap * sourceEntries.length;

	const sources = sourceEntries.map((entry, columnIndex) => ({
		key: entry.key,
		label: entry.label,
		cx: columnGap / 2 + columnIndex * columnGap
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
			severity: finding.severity,
			treatmentStatus: finding.treatment.status
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

	// Every dot sits on the strip's vertical centre; the connector is a horizontal
	// line between the first and last filled dot in that same centre line.
	const cy = STRIP_HEIGHT / 2;
	const lineGen = line<{ cx: number; cy: number }>()
		.x((d) => d.cx)
		.y((d) => d.cy);

	const rows: IntersectionRow[] = unordered.map((row) => {
		const dots = sources.map((source, columnIndex) => ({
			cx: source.cx,
			filled: row.membership[columnIndex]
		}));
		const filledDots = dots.filter((dot) => dot.filled);
		const linePath =
			filledDots.length >= 2
				? (lineGen(filledDots.map((dot) => ({ cx: dot.cx, cy }))) ?? undefined)
				: undefined;
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
		sources,
		rows,
		strip: { width: stripWidth, height: STRIP_HEIGHT },
		dotRadius: DOT_RADIUS
	};
}
