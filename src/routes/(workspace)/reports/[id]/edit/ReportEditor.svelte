<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { formatUtcTime } from '$lib/format';
	import type { DocumentV1 } from '$lib/schema';
	import { isBindable } from '$lib/schema';
	import type { BlockDiagnostic } from '$lib/server/ingestion';
	import { THEME_OPTIONS, themeFallbackWarning } from '$lib/render';
	import Button from '$lib/ui/Button.svelte';
	import StatusChip from '$lib/ui/StatusChip.svelte';
	import BlockBinder from './BlockBinder.svelte';
	import RefillPanel from './RefillPanel.svelte';
	import GeneratePanel from './GeneratePanel.svelte';
	import IssueList from './IssueList.svelte';
	import SectionEditor from './SectionEditor.svelte';
	import LivePreview from '../preview/LivePreview.svelte';
	import {
		groupErrorsByLocation,
		moveItem,
		newSection,
		optimisticDocumentIssues,
		type EditorIssue,
		type ErrorsByKey
	} from './editor-state';
	import { EditHistory } from './editor-history';
	import type { DiagnosticContext } from './editor-types';
	import type { ActionData, PageData } from './$types';

	// The page remounts this component via {#key report.id}, so capturing the
	// document once at init is the intended lifecycle (fresh state per report).
	// The lifecycle status, by contrast, is read live off the prop so publish /
	// unpublish (which invalidateAll to refresh `report`) flip the editor between
	// editable and read-only without losing the in-memory document.
	interface Props {
		report: PageData['report'];
		dataSets: PageData['dataSets'];
		skeletons: PageData['skeletons'];
		aiEnabled: PageData['aiEnabled'];
		form: ActionData;
	}

	let { report, dataSets, skeletons, aiEnabled, form }: Props = $props();

	const editable = $derived(report.status === 'draft');

	// svelte-ignore state_referenced_locally
	// WHY: a one-time deep copy of the loaded row at init - reading `report.document`
	// here is the intended capture (the page remounts per report.id), not a reactive
	// dependency. We deliberately fork the in-edit state so edits never alias the row.
	let doc = $state(structuredClone(report.document));

	// Theme selection (Story 6.5). The picker offers only known built-in themes;
	// an empty value means "no selection" and renders the default (FR39). A
	// stored document whose `theme` references a removed/unknown theme still
	// loads (the render path falls back to default, AC3) and flags here so the
	// author sees why the report shows the default theme.
	const themeWarning = $derived(themeFallbackWarning(doc.theme));

	function onThemeChange(value: string): void {
		doc.theme = value === '' ? undefined : value;
		onEdit();
	}

	let dirty = $state(false);
	let saving = $state(false);
	// svelte-ignore state_referenced_locally
	// WHY: a one-time seed of the displayed timestamp from the loaded row; thereafter
	// `savedAt` is owned by the save callbacks, not derived from the prop.
	let savedAt = $state(report.updatedAt.toISOString());
	// Optimistic concurrency (Epic 10.1): the `updatedAt` the next save asserts.
	// Seeded from the loaded row and advanced to each successful save's timestamp,
	// so a write that lands after a concurrent edit (a second tab, an API push, an
	// MCP write) is the 409 conflict the editor surfaces, never a silent overwrite.
	// svelte-ignore state_referenced_locally
	// WHY: a one-time seed of the concurrency token from the loaded row; the save and
	// publish/unpublish callbacks own every later transition (the prop is not the source
	// of truth once editing starts).
	let expectedUpdatedAt = $state(report.updatedAt.toISOString());
	// True once a save came back 409: the in-memory edits are ahead of a newer
	// server state, so the author must reload to reconcile before saving again.
	let conflict = $state(false);
	// Per-block binding diagnostics from the last rebind (Epic 10.5): the editor
	// surfaces them at the block being edited (the chip + the inline remap), keyed
	// by block id, AND on the refill panel summary. A rebind replaces this set; a
	// bind/remap leaves it (those touch one block, the panel re-reads on its own).
	let bindingDiagnostics = $state<BlockDiagnostic[]>([]);
	// The fresh data set id behind the current diagnostics (the rebind source): the
	// per-block remap form needs it to point an expected field at an available one.
	let diagnosticDataSetId = $state<string | null>(null);
	// null = no JS save yet (fall back to the server-rendered `form` prop, the
	// no-JS path); [] = last JS save succeeded; entries = last JS save failed.
	let clientErrors = $state<EditorIssue[] | null>(null);
	let saveMessage = $state<string | null>(null);
	// The autosave INFRASTRUCTURE-failure flag (Story 10.7), distinct from a
	// validation failure (which renders inline at the failing block, not in the save
	// indicator): true when the last save could not complete for a reason the author
	// resolves by RETRYING - the server was unreachable (`result.type === 'error'`)
	// or a non-409 failure with no actionable inline errors (a 413, a 400 malformed
	// payload, a 5xx). The status indicator surfaces it as "Save failed - retry" with
	// a retry control; a fresh edit or a successful save clears it. A 409 is NOT a
	// save failure - it has its own conflict banner and resolve path.
	let saveFailed = $state(false);
	// Reactive: the error-to-block mapping below maps issues against the document
	// that was SUBMITTED (the one the server rejected), not the live doc. As a
	// plain `let` the $derived captured the initial null and never re-grouped
	// after a save reassigned it; $state makes the reassignment reactive.
	let submittedDoc = $state<DocumentV1 | null>(null);
	let saveFormElement: HTMLFormElement | undefined = $state();
	let autosaveTimer: ReturnType<typeof setTimeout> | undefined;

	// Debounced "settled" snapshot (Epic 10.1 perf): the live preview render and
	// the optimistic validation are both expensive (a full `documentSchemaV1`
	// safeParse with three cross-reference passes, plus the `{#key}` remount of the
	// whole Report tree). Running them on EVERY keystroke janks the editor. Instead
	// a single `$state.snapshot(doc)` is captured at most once per
	// PREVIEW_DEBOUNCE_MS and both consumers derive off it, so the heavy work fires
	// ~200 ms after typing stops, not per character. This is independent of the
	// 800 ms autosave debounce (which posts to the server); here we only throttle
	// the in-tab preview + inline-error recompute.
	const PREVIEW_DEBOUNCE_MS = 200;
	// Seeded synchronously from the loaded doc so the first paint already shows the
	// preview and any load-time issues; the $effect below keeps it settled-fresh.
	// svelte-ignore state_referenced_locally
	// WHY: a one-time init capture of the live doc. A binding action's
	// `reconcileBinding` reassigns `doc` (the reseed), so the analyzer now flags this
	// read; the $effect below re-settles the snapshot on every doc change (including a
	// reseed), so the init read is intentionally the loaded value, not a stale alias.
	let settledSnapshot = $state<DocumentV1>($state.snapshot(doc) as DocumentV1);
	let settleTimer: ReturnType<typeof setTimeout> | undefined;

	// In-tab undo/redo history (Story 10.7). A bounded stack of document snapshots
	// the author steps back/forward through, CLIENT-SIDE only - not a
	// server-versioned history (an explicit non-goal: concurrency is handled by the
	// optimistic-concurrency conflict path, undo/redo is an in-tab convenience). The
	// stack holds `$state.snapshot(doc)` deep clones, coalesced so a typing burst is
	// one step and bounded in depth (`EditHistory` owns both). `previewLevel` is a
	// VIEW concern owned by LivePreview, never part of `doc`, so it is excluded from
	// the history by construction (10.6 Dev Notes). The history records off the SAME
	// 200 ms settle the preview/validation use, so it shares the keystroke-coalescing
	// the editor already does; `EditHistory`'s own window merges rapid successive
	// settles into one undo step too.
	// svelte-ignore state_referenced_locally
	// WHY: a one-time capture of the loaded doc as the history baseline (the page
	// remounts per report.id). Every later transition goes through `record` (on
	// settle) or `reseed` (a server reseed), never a re-read of this initial value.
	const history = new EditHistory<DocumentV1>($state.snapshot(doc) as DocumentV1);
	let canUndo = $state(false);
	let canRedo = $state(false);
	// When true, the next settle must NOT push to the history: the `doc` change came
	// from an undo/redo restore or a server reseed, not a fresh author edit, so
	// recording it would corrupt the stack (re-pushing a state the cursor already
	// sits on). One-shot: the settle that consumes it clears it.
	let skipHistoryRecord = false;

	function refreshHistoryFlags(): void {
		canUndo = history.canUndo;
		canRedo = history.canRedo;
	}

	// One clone per settle, shared by the preview, the validation, and the undo
	// history. Watching `doc` (deep) schedules a single deferred capture; a burst of
	// keystrokes collapses to one snapshot. The capture itself is the only
	// `$state.snapshot` of the live doc on the hot path - the heavy consumers read
	// `settledSnapshot`, and the history records the same clone.
	$effect(() => {
		// Touch the document so the effect re-runs on any nested edit.
		void doc;
		clearTimeout(settleTimer);
		settleTimer = setTimeout(() => {
			const snapshot = $state.snapshot(doc) as DocumentV1;
			settledSnapshot = snapshot;
			if (skipHistoryRecord) {
				// A restore/reseed already set the history cursor; do not re-record it.
				skipHistoryRecord = false;
			} else {
				history.record(snapshot);
				refreshHistoryFlags();
			}
		}, PREVIEW_DEBOUNCE_MS);
		return () => clearTimeout(settleTimer);
	});

	// Applies a restored snapshot onto the working copy as if it were any other edit
	// (Story 10.7): undo/redo MUTATES the document and rides the same validated-save
	// seam, so the next autosave persists the restored state through validate-on-write.
	// The settle that follows is told to skip the history record (the cursor already
	// moved inside `EditHistory`), so an undo does not itself become a new undo step.
	function applyRestored(snapshot: DocumentV1): void {
		doc = snapshot;
		skipHistoryRecord = true;
		refreshHistoryFlags();
		onEdit();
	}

	function undo(): void {
		if (!editable) return;
		const restored = history.undo();
		if (restored) applyRestored(restored);
	}

	function redo(): void {
		if (!editable) return;
		const restored = history.redo();
		if (restored) applyRestored(restored);
	}

	// Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z (or Ctrl/Cmd+Y) redoes - the platform
	// conventions, alongside the visible toolbar buttons (an undo affordance must not
	// be keyboard-only, NFR15). Ignored while a native text field is composing is not
	// needed: undo/redo here operates on the document model, and the browser's own
	// per-field text undo is a separate concern the author keeps inside an input. We
	// only act on the document shortcut when the editor is editable and a redo/undo is
	// actually available, and we preventDefault so the browser's page-level undo does
	// not also fire.
	function onKeydown(event: KeyboardEvent): void {
		if (!editable) return;
		const mod = event.ctrlKey || event.metaKey;
		if (!mod) return;
		const key = event.key.toLowerCase();
		if (key === 'z' && !event.shiftKey) {
			if (!history.canUndo) return;
			event.preventDefault();
			undo();
		} else if ((key === 'z' && event.shiftKey) || key === 'y') {
			if (!history.canRedo) return;
			event.preventDefault();
			redo();
		}
	}

	// Optimistic client validation (Epic 10.1): the editor parses the in-edit
	// document against the SAME isomorphic `documentSchemaV1` the server validates
	// with, so a problem is placed inline at the failing block BEFORE any round-trip.
	// Guidance, never a gate - the author keeps editing, and the server
	// validate-on-write stays the only authority (an invalid document is rejected
	// there even if this passed). It runs off the DEBOUNCED `settledSnapshot`, not
	// the live doc, so the full safeParse fires ~200 ms after typing stops rather
	// than per keystroke. Issues still group against the live `doc` below (by stable
	// block id), so they track the block the author is editing. `optimisticDocumentIssues`
	// reuses the per-block/section schemas the renderer already ships, so it adds
	// zero bytes to the reader path (it never imports the server-side validate-on-write helper).
	const optimisticIssues: EditorIssue[] = $derived(optimisticDocumentIssues(settledSnapshot));

	// Data-bindable blocks (table/chart/kpi), labelled for the binder's block
	// picker. These are STRUCTURAL (which blocks exist), so they derive off the
	// debounced `settledSnapshot` rather than the live `doc`: a binder list that
	// lags the 200 ms settle is fine, and it keeps the flatMap off the keystroke
	// hot path. Recomputed as the author adds/removes blocks (after the settle).
	const bindableBlocks = $derived(
		settledSnapshot.sections.flatMap((section) =>
			section.blocks.filter(isBindable).map((block) => ({
				id: block.id,
				type: block.type,
				label: `${section.title} - ${block.type}`
			}))
		)
	);

	// The comparison-matrix blocks, for the set-membership block editor's source
	// picker (story 7.4): a set-membership block references one by id. Also
	// structural, so it derives off the settled snapshot for the same reason.
	const matrixBlocks = $derived(
		settledSnapshot.sections.flatMap((section) =>
			section.blocks
				.filter((block) => block.type === 'comparison-matrix')
				.map((block) => ({ id: block.id, label: `${section.title} - ${block.id}` }))
		)
	);

	// What the inline placement renders. After a JS save that FAILED, the server's
	// authoritative errors (`clientErrors`) take precedence and map against the
	// submitted document. Otherwise the optimistic client issues guide the live
	// document. The no-JS fallback (`form?.errors`) stands in before any JS save.
	const issues: EditorIssue[] = $derived(
		clientErrors !== null && clientErrors.length > 0
			? clientErrors
			: (form?.errors ?? optimisticIssues)
	);
	// The issue-to-block index source. `groupErrorsByLocation` is O(sections*blocks),
	// and `issues` only change every PREVIEW_DEBOUNCE_MS (the optimistic pass runs off
	// the settled snapshot), so indexing against the LIVE `doc` would re-run the whole
	// placement on every keystroke for no benefit. Index against `settledSnapshot`
	// instead, putting placement behind the same 200 ms debounce as the issues it
	// places - block ids are stable across the settle, so inline errors still land on
	// the right block. The failed-save branch keeps using the SUBMITTED document
	// (`submittedDoc`), since those errors are indexed against what the server rejected.
	const errorsByKey: ErrorsByKey = $derived(
		groupErrorsByLocation(
			issues,
			clientErrors !== null && clientErrors.length > 0
				? (submittedDoc ?? settledSnapshot)
				: settledSnapshot
		)
	);
	const documentIssues: EditorIssue[] = $derived(errorsByKey['document'] ?? []);
	const failureMessage: string | null = $derived(
		saveMessage ??
			(clientErrors === null && (form?.errors?.length ?? 0) === 0 ? (form?.message ?? null) : null)
	);

	// The authoritative live preview (Epic 10.1): the SAME debounced `settledSnapshot`
	// the optimistic validation reads, fed to the SAME pure `$lib/render` tier the
	// reader SSR path uses (through the embedded LivePreview). What the author edits
	// is what the reader gets - this is the reader render, not a lookalike. Feeding
	// the SETTLED snapshot (one clone per settle, shared with the validation) means
	// the LivePreview `{#key document}` remount throttles to ~200 ms after typing
	// stops instead of tearing down and rebuilding the whole Report tree (onMount,
	// IntersectionObserver, every chart's d3 geometry) on every keystroke. A
	// transiently-invalid snapshot still renders (LivePreview goes through
	// `toPreviewView`, which renders valid blocks and flags invalid ones rather than
	// crashing).
	const previewSnapshot = $derived(settledSnapshot);

	// The embedded split preview is a VIEW concern, off by default so opening a
	// report shows the editing form full-width rather than a preview the author did
	// not ask for. The author reveals it on demand via the toolbar toggle; when open
	// it sits BESIDE the form (a flex column), never over it. The full-page preview
	// route and "View as reader" remain the other two ways to see the render.
	let previewOpen = $state(false);

	/*
	 * Autosave concurrency contract (story 1.5, made explicit in 10.1 ahead of
	 * 10.2-10.7 adding more save triggers). The save form is a real form action
	 * with a visible Save button (no-JS baseline posts the named narrative fields).
	 * With JS, the one code path is `scheduleSave()` -> debounce -> requestSubmit()
	 * -> use:enhance (`submitSave`); the enhance callback injects the serialized
	 * document and applies the result without a data reload (a reload would clobber
	 * in-flight edits). A beforeunload guard covers the window between an edit and
	 * its save.
	 *
	 * State machine (the invariant every save trigger obeys):
	 *  - `saving` = at most ONE save is in flight at a time.
	 *  - `pendingSave` = at most ONE save is queued behind the in-flight one. An
	 *    edit (or a save fired while one is in flight) sets it; the in-flight
	 *    callback's `finally` flushes it via `scheduleSave()`, so the latest state
	 *    always lands without overlapping writes.
	 *  - `conflict` is owned here: cleared on a successful save AND on the
	 *    cancel-when-in-flight path (the queued save will re-assert), set only on a
	 *    409. It is never left stale by a dropped submit.
	 */
	const AUTOSAVE_DEBOUNCE_MS = 800;
	let pendingSave = false;

	// The single named save seam: every autosave trigger (an edit today, the
	// palette/binder writes 10.2-10.7 add) goes through here, never a raw timer.
	function scheduleSave(): void {
		if (!editable) return;
		clearTimeout(autosaveTimer);
		autosaveTimer = setTimeout(() => saveFormElement?.requestSubmit(), AUTOSAVE_DEBOUNCE_MS);
	}

	function onEdit(): void {
		if (!editable) return;
		dirty = true;
		// A fresh edit clears a prior save-failure status: the queued save will retry
		// with the new state, so the stale "Save failed" must not linger over a
		// document the author has since moved on from.
		saveFailed = false;
		scheduleSave();
	}

	// The explicit retry behind the "Save failed - retry" status (Story 10.7): re-arm
	// the single save seam so the latest working copy is reposted through the same
	// validated path. Clearing the flag optimistically keeps the indicator honest -
	// it flips back to failed only if the retry fails again.
	function retrySave(): void {
		if (!editable) return;
		saveFailed = false;
		scheduleSave();
	}

	// Section-level structural-edit focus management (Story 10.2, NFR15). Like the
	// block case in SectionEditor, a section add / move / delete rebuilds the keyed
	// `{#each}`, so we move focus to the affected section's card (a `tabindex="-1"`
	// region) once the DOM settles: a moved section keeps focus (so repeated up/down
	// presses keep working), an added section is focused, and after a delete focus
	// lands on the neighbour that took its place (or the "Add section" button when no
	// section remains). The same validated working-copy path carries every change.
	let sectionsElement = $state<HTMLDivElement>();
	let addSectionButton = $state<HTMLButtonElement>();

	async function focusSection(sectionId: string): Promise<void> {
		await tick();
		sectionsElement
			?.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(sectionId)}"]`)
			?.focus();
	}

	function insertSection(): void {
		const section = newSection();
		doc.sections.push(section);
		onEdit();
		void focusSection(section.id);
	}

	function removeSection(index: number): void {
		doc.sections.splice(index, 1);
		onEdit();
		const next = doc.sections[index] ?? doc.sections[index - 1];
		if (next) {
			void focusSection(next.id);
		} else {
			void tick().then(() => addSectionButton?.focus());
		}
	}

	function moveSection(index: number, direction: -1 | 1): void {
		const movedId = doc.sections[index].id;
		moveItem(doc.sections, index, direction);
		onEdit();
		void focusSection(movedId);
	}

	const submitSave: SubmitFunction = ({ formData, cancel }) => {
		if (!editable) {
			cancel();
			return;
		}
		if (saving) {
			// A save is in flight: drop this submit and QUEUE one. The in-flight
			// callback's finally flushes the queue, so the latest state still lands
			// (at-most-one-queued). Clear any stale conflict flag - the queued save
			// re-asserts the current token.
			cancel();
			pendingSave = true;
			conflict = false;
			return;
		}
		clearTimeout(autosaveTimer);
		const snapshot = $state.snapshot(doc) as DocumentV1;
		submittedDoc = snapshot;
		formData.set('document', JSON.stringify(snapshot));
		// Assert the loaded/last-saved `updatedAt`: the service rejects a write that
		// lands after a concurrent edit as a 409 conflict (optimistic concurrency).
		formData.set('expectedUpdatedAt', expectedUpdatedAt);
		saving = true;
		return async ({ result }) => {
			try {
				if (result.type === 'success') {
					dirty = false;
					conflict = false;
					saveFailed = false;
					clientErrors = [];
					saveMessage = null;
					const payload = result.data as { savedAt?: string } | undefined;
					if (payload?.savedAt) {
						savedAt = payload.savedAt;
						// Advance the concurrency token so the NEXT save asserts against the
						// state this save just wrote, not the stale loaded value.
						expectedUpdatedAt = payload.savedAt;
					}
				} else if (result.type === 'failure') {
					if (result.status === 409) {
						// A concurrent write landed between load and save: surface the conflict
						// and the resolve path (reload). Do NOT advance the token or clear the
						// in-memory edits - the author reloads to reconcile, never a silent
						// last-writer-wins overwrite. A 409 also drops any queued save: the
						// author must reconcile first (a queued write would just 409 again).
						conflict = true;
						pendingSave = false;
						clientErrors = [];
						const payload = result.data as { message?: string } | undefined;
						saveMessage =
							payload?.message ??
							'This report changed since you opened it. Reload to get the latest version, then reapply your edits.';
						return;
					}
					const payload = result.data as { errors?: EditorIssue[]; message?: string } | undefined;
					clientErrors = payload?.errors ?? [];
					saveMessage = clientErrors.length === 0 ? (payload?.message ?? 'Save failed.') : null;
					// A non-409 failure with no inline errors (413/400/5xx) is an
					// infrastructure failure the author retries; one carrying inline errors
					// is a validation failure the author fixes at the block, not a retry.
					saveFailed = clientErrors.length === 0;
				} else if (result.type === 'error') {
					clientErrors = [];
					saveMessage = 'Save failed: the server could not be reached.';
					saveFailed = true;
				}
			} finally {
				saving = false;
				// Flush the at-most-one queued save: an edit landed while this one was
				// in flight, so re-arm the single save path to carry the latest state.
				if (pendingSave) {
					pendingSave = false;
					scheduleSave();
				}
			}
		};
	};

	let publishing = $state(false);

	// Morphing primary action (UX): a draft is published from here; publishing
	// validates server-side, so an invalid draft comes back as the same errors[]
	// the save path renders inline at the failing blocks. A published report
	// reverts to draft to resume editing. Both refresh `report` via invalidateAll
	// so the editor flips read-only/editable without a full remount.
	const submitPublish: SubmitFunction = ({ cancel }) => {
		if (saving || dirty) {
			// A draft save is in flight or pending: publishing now could freeze a
			// stale snapshot. Cancel and let the autosave land; the author retries.
			cancel();
			saveMessage = 'Saving your latest edits - try publishing again in a moment.';
			return;
		}
		publishing = true;
		return async ({ result }) => {
			publishing = false;
			if (result.type === 'success') {
				clientErrors = [];
				saveMessage = null;
				// publish wrote a new `updatedAt`; reconcile the concurrency token from the
				// action RESULT (self-contained) so a later unpublish-then-edit save asserts
				// the latest state, not the stale pre-publish value. Seeding from the result
				// rather than the post-invalidateAll prop removes the dependency on update
				// ordering.
				const payload = result.data as { savedAt?: string } | undefined;
				if (payload?.savedAt) {
					expectedUpdatedAt = payload.savedAt;
					savedAt = payload.savedAt;
				}
				// Publishing reseeds the undo baseline (Story 10.7): the published state is
				// the new floor, so a later unpublish-then-edit cannot undo PAST it into a
				// pre-publish document the server has already snapshotted.
				history.reseed($state.snapshot(doc) as DocumentV1);
				skipHistoryRecord = true;
				refreshHistoryFlags();
				await invalidateAll();
			} else if (result.type === 'failure') {
				const payload = result.data as { errors?: EditorIssue[]; message?: string } | undefined;
				submittedDoc = $state.snapshot(doc) as DocumentV1;
				clientErrors = payload?.errors ?? [];
				saveMessage = clientErrors.length === 0 ? (payload?.message ?? 'Publish failed.') : null;
			} else if (result.type === 'error') {
				clientErrors = [];
				saveMessage = 'Publish failed: the server could not be reached.';
			}
		};
	};

	const submitUnpublish: SubmitFunction = () => {
		publishing = true;
		return async ({ result }) => {
			publishing = false;
			if (result.type === 'success') {
				clientErrors = [];
				saveMessage = null;
				conflict = false;
				// unpublish wrote a new `updatedAt`; reconcile the concurrency token from
				// the action RESULT (self-contained) so the first edit-and-save after
				// returning to draft asserts the latest state instead of a stale one (a
				// spurious 409). Seeding from the result rather than the post-invalidateAll
				// prop removes the dependency on update ordering.
				const payload = result.data as { savedAt?: string } | undefined;
				if (payload?.savedAt) {
					expectedUpdatedAt = payload.savedAt;
					savedAt = payload.savedAt;
				}
				// Returning to draft reseeds the undo baseline (Story 10.7): editing resumes
				// from the just-unpublished state as the new floor, so undo cannot reach back
				// across the publish/unpublish boundary into a stale document.
				history.reseed($state.snapshot(doc) as DocumentV1);
				skipHistoryRecord = true;
				refreshHistoryFlags();
				await invalidateAll();
			} else if (result.type === 'failure') {
				const payload = result.data as { message?: string } | undefined;
				saveMessage = payload?.message ?? 'Unpublish failed.';
			}
		};
	};

	// Dirty/saving guard for a binding action (Epic 10.5, the DATA-LOSS fix). A
	// bind / rebind / remap reads the SERVER's last-saved document (the binding
	// services call getReport, not the editor's in-memory doc) and its result drives
	// reconcileBinding, which REPLACES the working copy + cancels the pending autosave
	// + clears dirty. If the author has unsaved edits in flight (a typed title, an
	// added section the 800 ms autosave has not yet posted), submitting a binding
	// action would overwrite those edits with the server-derived document - silently,
	// no conflict surfaced. So mirror the publish guard exactly: while dirty or saving,
	// do NOT submit; cancel, let the autosave land, prompt the author to retry. This
	// also closes the saving-in-flight reconcile race (a bind cannot start mid-save).
	function bindingGuard(cancel: () => void): boolean {
		if (saving || dirty) {
			cancel();
			scheduleSave();
			saveMessage = 'Saving your latest edits - try binding again in a moment.';
			return false;
		}
		return true;
	}

	// Binding-action concurrency reconciliation (Epic 10.5, the key correctness
	// point). A bind / rebind / remap is a server action that MUTATES the report
	// through the same validate-on-write path a save uses, so it advances the row's
	// `updatedAt`. Unreconciled, the editor's `expectedUpdatedAt` would stay at the
	// pre-bind value and the NEXT document save would assert a stale token and 409
	// spuriously. So a binding action returns the re-resolved document + its new
	// `updatedAt`, and the editor reseeds its working copy and advances the token
	// from THIS result - exactly the self-contained reconciliation publish/unpublish
	// use, plus the document reseed (a bind changes the document, not just the
	// timestamp). The reseed deep-copies so the working copy never aliases the
	// action payload. Any pending document save is dropped: the binding write already
	// carried the latest document forward, and the reseeded copy is the new baseline.
	function reconcileBinding(savedAtIso: string, document: DocumentV1): void {
		doc = structuredClone(document);
		expectedUpdatedAt = savedAtIso;
		savedAt = savedAtIso;
		dirty = false;
		pendingSave = false;
		conflict = false;
		clearTimeout(autosaveTimer);
		clientErrors = [];
		saveMessage = null;
		// A binding reconcile is a SERVER reseed (Story 10.7): the re-resolved document
		// is a new authoritative baseline, not an undo step the author steps PAST into
		// the pre-bind state (10.5 Dev Notes). Reseed the history to this baseline so
		// undo/redo cannot resurrect the stale pre-reconcile document, and skip the
		// settle's record (the reseed already placed the cursor).
		history.reseed($state.snapshot(doc) as DocumentV1);
		skipHistoryRecord = true;
		refreshHistoryFlags();
	}

	function onBound(savedAtIso: string, document: DocumentV1): void {
		reconcileBinding(savedAtIso, document);
		// A bind re-resolves this block's state from scratch, so any per-block
		// diagnostics from a PRIOR rebind no longer describe the document. Clear them
		// (and the diagnostic source) so a stale drift chip never lingers on a block the
		// author just re-bound; a fresh rebind repopulates them.
		bindingDiagnostics = [];
		diagnosticDataSetId = null;
	}

	function onRebound(
		savedAtIso: string,
		document: DocumentV1,
		diagnostics: BlockDiagnostic[],
		dataSetId: string
	): void {
		reconcileBinding(savedAtIso, document);
		bindingDiagnostics = diagnostics;
		diagnosticDataSetId = dataSetId;
	}

	function onRemapped(savedAtIso: string, document: DocumentV1, blockId: string): void {
		reconcileBinding(savedAtIso, document);
		// A remap re-resolved this block: drop its drift from the surfaced diagnostics
		// so the now-green block stops showing the chip + the inline remap. A block that
		// resolved cleanly carries no per-block diagnostic to surface.
		bindingDiagnostics = bindingDiagnostics.filter((d) => d.blockId !== blockId);
	}

	// Per-block diagnostic index (Epic 10.5): the bindable block editors look up
	// their drift state by block id to render the chip + the inline remap at the
	// block. Only drifted/unresolved blocks need surfacing; a bound block is clean.
	const diagnosticsByBlock = $derived(
		new Map(bindingDiagnostics.filter((d) => d.state !== 'bound').map((d) => [d.blockId, d]))
	);

	// The available field names behind the current diagnostics (the rebind source's
	// columns), for the per-block remap pick. Derived off the loaded data sets so it
	// needs no extra round-trip. Empty when no rebind has run this session.
	const diagnosticFields = $derived(
		diagnosticDataSetId === null
			? []
			: (dataSets.find((set) => set.id === diagnosticDataSetId)?.fields.map((f) => f.name) ?? [])
	);

	// One diagnostic context object (Epic 10.5): the per-block index, the rebind
	// source's available fields, and its data set id - threaded as a SINGLE prop
	// through SectionEditor (a clean pass-through) to BlockEditor, instead of three
	// sibling props that are always populated, threaded and cleared together.
	const diagnostics: DiagnosticContext = $derived({
		byBlock: diagnosticsByBlock,
		fields: diagnosticFields,
		dataSetId: diagnosticDataSetId
	});

	function savedAtLabel(iso: string): string {
		return `Saved at ${formatUtcTime(iso)}`;
	}

	// The autosave status indicator state (Story 10.7): one accessible, announced
	// label the author reads to know their work is safe - saving, saved-at-<time>, or
	// failed-retry. Precedence: an in-flight save wins (it is the live truth), then a
	// retry-able failure, otherwise the last saved-at confirmation. A 409 conflict is
	// NOT a save status here - it owns the dedicated conflict banner with its own
	// reload path. The kind drives the announcement + the retry affordance below.
	type SaveStatus = { kind: 'saving' | 'saved' | 'error'; label: string };
	const saveStatus: SaveStatus = $derived(
		saving
			? { kind: 'saving', label: 'Saving...' }
			: saveFailed
				? { kind: 'error', label: 'Save failed - retry' }
				: { kind: 'saved', label: savedAtLabel(savedAt) }
	);

	// Keyed remount per report id (the page wraps this in {#key report.id}), so
	// reading the id once at init is the intended lifecycle.
	// svelte-ignore state_referenced_locally
	const previewPath = resolve('/(workspace)/reports/[id]/preview', { id: report.id });
	// svelte-ignore state_referenced_locally
	const viewPath = resolve('/(workspace)/reports/[id]/view', { id: report.id });
	// svelte-ignore state_referenced_locally
	const sharePath = resolve('/(workspace)/reports/[id]/share', { id: report.id });
	// svelte-ignore state_referenced_locally
	const changesPath = resolve('/(workspace)/reports/[id]/changes', { id: report.id });
</script>

<svelte:head>
	<title>{doc.title} - Acta Diurna</title>
</svelte:head>

<svelte:window
	onbeforeunload={(event) => {
		if (dirty) event.preventDefault();
	}}
	onkeydown={onKeydown}
/>

<div class="editor-chrome">
	<div class="identity-row">
		<input
			class="report-title"
			name="title"
			form="report-save"
			value={doc.title}
			placeholder="Untitled report"
			disabled={!editable}
			oninput={(event) => {
				doc.title = event.currentTarget.value;
				onEdit();
			}}
			aria-label="Report title"
		/>
		<StatusChip status={report.status} />
		{#if editable}
			<!-- Autosave status (Story 10.7): announced saving / saved-at / failed so the
			     author always knows their work is safe. `role="status"` + `aria-live="polite"`
			     announces each transition; the failed state offers an explicit retry, and the
			     class drives a quiet colour cue (text carries the meaning, WCAG 1.4.1). -->
			<span class="save-status {saveStatus.kind}" role="status" aria-live="polite">
				{saveStatus.label}
			</span>
		{/if}
		<div class="identity-actions">
			{#if saveStatus.kind === 'error' && editable}
				<Button variant="secondary" onclick={retrySave}>Retry</Button>
			{/if}
			{#if editable}
				<!-- Save targets the editing form by id (`form=`), so the title and this
				     action sit in the identity row while the form wraps the body below. -->
				<Button type="submit" form="report-save" variant="secondary">Save</Button>
			{/if}
			<!-- Morphing primary action: publish a draft, or unpublish a published report.
			     Each is its own self-contained form, kept out of the editor fieldset so the
			     unpublish control stays enabled while the read-only body is disabled. -->
			{#if editable}
				<form method="POST" action="?/publish" use:enhance={submitPublish} class="lifecycle">
					<Button type="submit" variant="primary" disabled={publishing || saving}>
						{publishing ? 'Publishing...' : 'Publish'}
					</Button>
				</form>
			{:else}
				<form method="POST" action="?/unpublish" use:enhance={submitUnpublish} class="lifecycle">
					<span class="lifecycle-note">Published - unpublish to edit</span>
					<Button type="submit" variant="secondary" disabled={publishing}>
						{publishing ? 'Unpublishing...' : 'Unpublish'}
					</Button>
				</form>
			{/if}
		</div>
	</div>

	<div class="tool-strip">
		<div class="tool-group" role="group" aria-label="Preview the report">
			<span class="tool-group-label">View</span>
			<!-- Toggles the embedded split preview (off by default). Distinct from the
			     "Live preview" full-page link: this pane tracks the LIVE in-edit copy as the
			     author types, the link renders the last-saved snapshot full-screen. -->
			<Button
				variant="secondary"
				class="preview-toggle"
				aria-expanded={previewOpen}
				aria-controls="editor-preview"
				onclick={() => (previewOpen = !previewOpen)}
			>
				Split preview
			</Button>
			<a class="toolbar-link" href={previewPath} data-sveltekit-preload-data="off">Live preview</a>
			<a class="toolbar-link" href={viewPath} data-sveltekit-preload-data="off">View as reader</a>
			{#if !editable}
				<a class="toolbar-link" href={sharePath}>Share</a>
				<a class="toolbar-link" href={changesPath}>What changed</a>
			{/if}
		</div>

		<!-- In-tab undo/redo (Story 10.7): visible, labelled controls alongside the
		     Ctrl/Cmd+Z keyboard path (NFR15: an undo affordance is never keyboard-only).
		     Editable-only - a published report has no working-copy history to step. -->
		{#if editable}
			<div class="tool-group" role="group" aria-label="Undo and redo">
				<span class="tool-group-label">Edit</span>
				<Button variant="ghost" onclick={undo} disabled={!canUndo} aria-label="Undo">Undo</Button>
				<Button variant="ghost" onclick={redo} disabled={!canRedo} aria-label="Redo">Redo</Button>
			</div>
		{/if}

		<label class="theme-field">
			<span class="theme-label">Theme</span>
			<select
				class="theme-select"
				value={doc.theme ?? ''}
				disabled={!editable}
				onchange={(event) => onThemeChange(event.currentTarget.value)}
			>
				<option value="">Default (Modern Gazette)</option>
				{#each THEME_OPTIONS as option (option.name)}
					{#if option.name !== 'default'}
						<option value={option.name}>{option.label}</option>
					{/if}
				{/each}
			</select>
		</label>
	</div>

	{#if themeWarning}
		<p class="theme-warning" role="status">{themeWarning.message}</p>
	{/if}

	{#if !editable}
		<p class="published-note">
			This report is published and read-only. Readers see the snapshot taken at publish. Unpublish
			above to edit or delete it.
		</p>
	{/if}
</div>

<div class="editor-layout">
	<form
		id="report-save"
		method="POST"
		action="?/save"
		use:enhance={submitSave}
		bind:this={saveFormElement}
		class="editor-form"
	>
		<fieldset class="editor" disabled={!editable}>
			{#if conflict}
				<!-- Optimistic-concurrency conflict (Epic 10.1): a concurrent write landed
			     between load and save. The edits stay in memory; reloading reconciles
			     against the latest server state so the author reapplies, never a silent
			     last-writer-wins overwrite. -->
				<div class="conflict" role="alert">
					<p class="conflict-message">{saveMessage}</p>
					<Button type="button" variant="secondary" onclick={() => invalidateAll()}>
						Reload latest
					</Button>
				</div>
			{:else if failureMessage}
				<p class="problem" role="alert">{failureMessage}</p>
			{/if}

			<IssueList issues={documentIssues} variant="document" />

			<div bind:this={sectionsElement}>
				{#each doc.sections as section, sectionIndex (section.id)}
					<SectionEditor
						bind:section={doc.sections[sectionIndex]}
						{sectionIndex}
						count={doc.sections.length}
						errors={errorsByKey}
						scales={doc.scales}
						{matrixBlocks}
						{diagnostics}
						{bindingGuard}
						{onRemapped}
						{onEdit}
						onRemove={() => removeSection(sectionIndex)}
						onMove={(direction) => moveSection(sectionIndex, direction)}
					/>
				{/each}
			</div>

			<div class="add-section">
				<Button bind:ref={addSectionButton} onclick={insertSection}>Add section</Button>
			</div>
		</fieldset>
	</form>

	<!-- Authoritative live preview (Epic 10.1): the editor reuses the SAME embedded
	     LivePreview the /preview route uses, fed the LIVE in-edit snapshot so it
	     re-renders through the pure `$lib/render` tier on every edit. What the author
	     edits is what the reader gets - the preview IS the reader render. Off by
	     default (previewOpen), revealed beside the form via the toolbar toggle. -->
	{#if previewOpen}
		<aside id="editor-preview" class="editor-preview" aria-label="Live preview">
			<LivePreview document={previewSnapshot} />
		</aside>
	{/if}
</div>

<!-- Data binding from the editor (Epic 10.5): the bind / refill panels call the
     SAME existing `?/bind` / `?/rebind` / `?/remap` actions and binding services,
     reporting their re-resolved document + new `updatedAt` UP so the editor reseeds
     its working copy and advances the concurrency token (reconcileBinding) instead
     of an invalidateAll that would clobber in-flight edits and leave the token
     stale. The per-block diagnostics surface at the block too (threaded above). -->
<BlockBinder blocks={bindableBlocks} {dataSets} disabled={!editable} {bindingGuard} {onBound} />

<RefillPanel {dataSets} disabled={!editable} {bindingGuard} {onRebound} {onRemapped} />

<!-- UX Flow D (FR32): the Generate-with-AI entry point appears only when the
     connector is configured + opted-in; a disabled instance hides it entirely so
     the workspace never offers a capability that 503s. -->
{#if aiEnabled}
	<GeneratePanel {skeletons} {dataSets} disabled={!editable} />
{/if}

<style>
	/* Editor chrome: an identity row (title + status + the lone Publish CTA) over a
	   grouped tool strip (View / Edit / Theme). The document identity and its one
	   primary action read first; the situational tools cluster by family below,
	   instead of one undifferentiated button run. */
	.editor-chrome {
		margin-bottom: var(--space-5);
	}

	.identity-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.identity-actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-left: auto;
	}

	.tool-strip {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3) var(--space-5);
		margin-top: var(--space-3);
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-ink-12);
	}

	.tool-group {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.tool-group-label {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-ink-65);
	}

	.lifecycle {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0;
	}

	.lifecycle-note {
		font-size: var(--text-sm);
		color: var(--color-ink-65);
		white-space: nowrap;
	}

	.toolbar-link {
		padding: var(--space-2) var(--space-4);
		font-weight: 600;
		font-size: var(--text-base);
		color: var(--color-ink);
		text-decoration: none;
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.toolbar-link:hover {
		border-color: var(--color-purple);
		color: var(--color-purple);
	}

	/* Open state of the split-preview toggle: a filled pressed look so the active
	   state reads on its own, not only by the pane's presence. The selector reaches
	   into the Button child via :global (the class is forwarded onto its <button>). */
	:global(.preview-toggle[aria-expanded='true']) {
		color: var(--color-purple);
		border-color: var(--color-purple);
		background: var(--color-purple-08);
	}

	/* Two-pane editor shell (Epic 10.1): the form on the left, the authoritative
	   live preview on the right. The preview is sticky so it stays in view while the
	   author scrolls the form. On a narrow viewport the panes stack (the editor is a
	   desktop surface, NFR27 is a reader requirement, so this is graceful degradation
	   not a mobile authoring target). */
	.editor-layout {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--space-5);
	}

	.editor-form {
		flex: 1 1 440px;
		min-width: 0;
		margin: 0;
	}

	.editor-preview {
		flex: 1 1 440px;
		min-width: 0;
		position: sticky;
		top: var(--space-4);
	}

	.editor {
		margin: 0;
		padding: 0;
		border: 0;
	}

	.report-title {
		flex: 1 1 16rem;
		min-width: 0;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-size: 20px;
		font-weight: 600;
		color: inherit;
		background: transparent;
		/* A persistent faint underline marks the title as an editable field at rest,
		   not static heading text; hover/focus promote it to a full input frame. */
		border: 1px solid transparent;
		border-bottom-color: var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.report-title::placeholder {
		color: var(--color-ink-65);
		font-weight: 500;
	}

	.report-title:hover,
	.report-title:focus {
		background: var(--color-surface);
		border-color: var(--color-ink-25);
	}

	/* A published report's title is read-only: drop the editable underline and keep
	   it fully legible (WebView greys disabled inputs, so pin the text colour). */
	.report-title:disabled {
		border-bottom-color: transparent;
		color: var(--color-ink);
		-webkit-text-fill-color: var(--color-ink);
		opacity: 1;
	}

	/* Autosave status indicator (Story 10.7). The text carries the meaning; the
	   colour is a secondary cue (WCAG 1.4.1). Saved is quiet ink, saving is the same
	   quiet tone (transient), failed is danger to flag the work-at-risk state. */
	.save-status {
		font-size: var(--text-sm);
		white-space: nowrap;
		color: var(--color-ink-65);
	}

	.save-status.error {
		color: var(--color-danger);
		font-weight: 600;
	}

	/* Theme sits at the trailing edge of the tool strip. */
	.theme-field {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-left: auto;
	}

	.theme-label {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink-65);
	}

	.theme-select {
		padding: var(--space-1) var(--space-3);
		font: inherit;
		font-size: var(--text-sm);
		color: var(--color-ink);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	/* Theme fallback warning (AC3): the report references a removed/unknown theme,
	   so the reader sees the default. Amber, not danger - the report still renders
	   cleanly; this is advisory, not a validation error. */
	.theme-warning {
		margin: 0;
		padding: var(--space-2) var(--space-4);
		font-size: var(--text-sm);
		color: var(--color-amber);
		background: var(--color-amber-12);
		border-radius: var(--radius-sm);
	}

	.published-note {
		padding: var(--space-3) var(--space-4);
		color: var(--color-ink-65);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-sm);
	}

	.problem {
		padding: var(--space-3) var(--space-4);
		color: var(--color-danger);
		background: var(--color-danger-08);
		border-radius: var(--radius-sm);
	}

	/* Optimistic-concurrency conflict (Epic 10.1): an amber, actionable banner with
	   the resolve path (reload), distinct from the danger-toned validation problem -
	   the edits are intact, the report just moved on under the author. */
	.conflict {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		color: var(--color-ink);
		background: var(--color-amber-12);
		border: 1px solid var(--color-amber);
		border-radius: var(--radius-sm);
	}

	.conflict-message {
		margin: 0;
		font-size: var(--text-sm);
	}

	.add-section {
		margin-top: var(--space-4);
	}
</style>
