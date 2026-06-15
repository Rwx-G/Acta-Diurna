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
import { buildChangeSummaryEntries, type DocumentV1, type SeriesDiff } from '$lib/schema';

/**
 * Returns a copy of `published` with the Story 9.5 reader change-summary baked onto
 * its `changeSummary.entries`, distilled from the precomputed {@link SeriesDiff}. The
 * bake is a no-op (returns the input unchanged) when the opt-in is off (`changeSummary`
 * absent or `enabled: false`). When on, it distills the diff into the leak-safe
 * entries; a `no-predecessor` diff (first issue or unpublished predecessor) or a
 * drifted pair yields an empty/omitted summary so the panel simply does not appear.
 *
 * The caller passes the SAME `diff` it already computed for the publish (one traversal
 * of the document pair), so this bake does not re-diff: `diffSnapshots` walks both
 * documents (placeBlocks twice, a full per-block deepEqual), and running it again here
 * would double that cost on every opted-in publish. `predecessor` is the same snapshot
 * the diff was computed against; it is threaded through so a `removed` section's
 * audience tags - absent from `published` - are recovered for the entry.
 *
 * `published` is already validated and already carries the 9.4 baked KPI deltas (the
 * delta bake runs first), so the headline movements read the same figures the reader
 * sees. This never mutates the input (it rebuilds the `changeSummary` field), and the
 * result is re-validated by the caller before it is frozen.
 */
export function bakeChangeSummary(
	published: DocumentV1,
	diff: SeriesDiff,
	predecessor: DocumentV1 | null
): DocumentV1 {
	const optIn = published.changeSummary;
	// OFF by default: no opt-in, or opt-in disabled. Drop any stale baked entries so a
	// republish after the author turned the summary off never freezes a stale panel.
	if (optIn === undefined || optIn.enabled !== true) {
		if (optIn?.entries === undefined) return published;
		return { ...published, changeSummary: { enabled: optIn.enabled } };
	}

	const entries = buildChangeSummaryEntries(diff, published, predecessor ?? undefined);
	// Omit the `entries` key entirely when there is nothing to surface (a first issue,
	// an unpublished predecessor, a drifted pair, or a refill that changed nothing), so
	// the renderer's "no panel" branch fires on absence rather than an empty array.
	if (entries.length === 0) {
		return { ...published, changeSummary: { enabled: true } };
	}
	return { ...published, changeSummary: { enabled: true, entries } };
}
