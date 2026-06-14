/**
 * Publish-time change-summary baking (Epic 9, Story 9.5).
 *
 * Stamps the leak-safe reader-facing {@link ChangeSummary} entries onto a document's
 * `changeSummary` field by diffing this issue's published snapshot against the
 * predecessor's, then distilling the {@link SeriesDiff} to a sections-plus-headline-
 * movements summary. This is the server side of the precompute-onto-the-document
 * pattern set by the `binding.delta` bake (Story 9.4): the bake runs once at publish,
 * AFTER the delta bake (so the headline movements read the freshly-baked KPI deltas),
 * freezes the summary into the new issue's snapshot, and the PURE renderer reads it
 * straight off the validated document - no `$lib/server` in the render path, no client
 * compute, and no prior-issue raw content shipped to the reader.
 *
 * OPT-IN, OFF by default: the bake only ever fills `entries` when the document carries
 * `changeSummary.enabled === true`. A document with no `changeSummary`, or with
 * `enabled: false`, is returned structurally unchanged (any stale `entries` from a
 * prior publish are dropped, so a republish never freezes a summary the author has
 * since turned off).
 *
 * Omit-rather-than-mislead: a first issue, an unpublished predecessor, or a
 * substantial-drift pair yields NO entries (the diff is not a computed `diff`), so the
 * opt-in stays enabled but the panel does not appear - the same posture as the KPI
 * delta omission, never a misleading empty summary.
 */
import {
	buildChangeSummaryEntries,
	diffSnapshots,
	type DocumentV1,
	type NoPredecessorReason,
	type SeriesDiff
} from '$lib/schema';

/**
 * Returns a copy of `published` with the Story 9.5 reader change-summary baked onto
 * its `changeSummary.entries`, computed against `predecessor`. The bake is a no-op
 * (returns the input unchanged) when the opt-in is off (`changeSummary` absent or
 * `enabled: false`). When on, it diffs the issue against the predecessor and bakes the
 * leak-safe entries; a null predecessor (first issue or unpublished predecessor) or a
 * drifted pair bakes an empty/omitted summary so the panel simply does not appear.
 *
 * `published` is already validated and already carries the 9.4 baked KPI deltas (the
 * delta bake runs first), so the headline movements read the same figures the reader
 * sees. This never mutates the input (it rebuilds the `changeSummary` field), and the
 * result is re-validated by the caller before it is frozen.
 *
 * `noPredecessorReason` mirrors the delta bake's predecessor resolution: `null`
 * predecessor maps to a `no-predecessor` diff, so the builder yields no entries.
 */
export function bakeChangeSummary(
	published: DocumentV1,
	predecessor: DocumentV1 | null,
	noPredecessorReason: NoPredecessorReason = 'first-issue'
): DocumentV1 {
	const optIn = published.changeSummary;
	// OFF by default: no opt-in, or opt-in disabled. Drop any stale baked entries so a
	// republish after the author turned the summary off never freezes a stale panel.
	if (optIn === undefined || optIn.enabled !== true) {
		if (optIn?.entries === undefined) return published;
		return { ...published, changeSummary: { enabled: optIn.enabled } };
	}

	const diff: SeriesDiff = diffSnapshots(published, predecessor, noPredecessorReason);
	const entries = buildChangeSummaryEntries(diff, published);
	// Omit the `entries` key entirely when there is nothing to surface (a first issue,
	// an unpublished predecessor, a drifted pair, or a refill that changed nothing), so
	// the renderer's "no panel" branch fires on absence rather than an empty array.
	if (entries.length === 0) {
		return { ...published, changeSummary: { enabled: true } };
	}
	return { ...published, changeSummary: { enabled: true, entries } };
}
