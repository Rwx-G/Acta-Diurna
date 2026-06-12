import { z } from 'zod';
import { audiencesSchema, idSchema } from './shared.ts';
import { iconNameSchema } from '../icons.ts';
import { paragraphSchema } from './text.ts';

/**
 * Callout / admonition block (Epic 7, Story 7.7): a tinted, left-accent-bordered
 * box that elevates a verdict, summary, warning or resource list above the body
 * flow. The `tone` is a CLOSED enum (`info | success | warning | danger |
 * neutral`), NOT a document scale: a callout's colour language is a fixed,
 * theme-owned semantic set (`--report-tone-*` in `app.css`), so a callout needs
 * no `scales` declaration to render and an existing document gains the block
 * with zero authoring overhead. The optional `icon` reuses the 7.6 registry by
 * name (an unknown name fails the enum); the optional `kicker` is a short
 * header label; the `body` reuses the text block's rich-text vocabulary
 * (paragraphs of inline runs) so the callout renders escaped, no raw HTML.
 *
 * Tone is conveyed by MORE than colour (NFR14): the renderer pairs the tint with
 * the kicker label and/or the icon, so the callout's meaning survives without
 * colour. Colour resolution is a render concern; the schema carries only the
 * tone name.
 *
 * Isomorphic by design: this module imports nothing from `$lib/server` or
 * `$lib/ui`. An invalid tone or an unknown icon name fails validation with an
 * actionable problem-details error naming the offending field (FR2 parity).
 */

/**
 * The closed tonal vocabulary. Generic and domain-neutral: `info` for a note,
 * `success` for a positive verdict, `warning` for a caution, `danger` for a
 * critical alert, `neutral` for an unaccented aside. Each resolves to one
 * theme-owned semantic colour (`--report-tone-<tone>`); no per-block colour is
 * authored.
 */
export const CALLOUT_TONES = ['info', 'success', 'warning', 'danger', 'neutral'] as const;

export const calloutToneSchema = z.enum(CALLOUT_TONES);

export type CalloutTone = z.infer<typeof calloutToneSchema>;

/** DoS cap on the rich-text body, mirroring the text block's paragraph ceiling. */
export const MAX_CALLOUT_PARAGRAPHS = 50;

export const calloutBlockSchema = z.object({
	type: z.literal('callout'),
	id: idSchema,
	audiences: audiencesSchema.optional(),
	// The callout's tonal accent. A closed enum, not a scale reference: the colour
	// is theme-owned, resolved at render from `--report-tone-<tone>`.
	tone: calloutToneSchema,
	// Optional glyph from the 7.6 icon registry, by name. An unknown name fails
	// the enum with the valid set as its hint (FR2 parity).
	icon: iconNameSchema.optional(),
	// Optional short header label, rendered uppercase beside the icon. Carries the
	// tone meaning in words, so colour is never the sole signal (NFR14).
	kicker: z.string().min(1).max(120, 'Callout kicker too long: 120 characters maximum.').optional(),
	// The rich-text body: paragraphs of inline runs, the SAME vocabulary the text
	// block uses, so the body renders escaped with no raw HTML.
	body: z
		.array(paragraphSchema)
		.min(1, 'A callout must contain at least one paragraph.')
		.max(MAX_CALLOUT_PARAGRAPHS, 'Too many paragraphs in a callout: 50 maximum.')
});

export type CalloutBlock = z.infer<typeof calloutBlockSchema>;
