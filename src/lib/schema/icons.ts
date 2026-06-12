/**
 * Curated inline-SVG icon name enum (Epic 7, Story 7.6). A small FIXED set of
 * generic, domain-neutral glyph names that blocks reference by name (the callout
 * of 7.7 and the card grid of 7.9 consume it). The matching SSR `<svg>` markup
 * lives in the render tier (`render/blocks/icons.ts`), keyed by these exact
 * names; a lockstep test holds the two in step so neither can drift.
 *
 * Isomorphic by design: this module imports nothing from `$lib/server` or
 * `$lib/ui`. The name is the only thing the document carries; the SVG is render
 * detail, never authored or stored.
 *
 * An unknown name fails validation with an actionable problem-details error
 * listing the valid names - the enum's `invalid_value` issue carries the allowed
 * set as its hint (`errors.ts` `hintForCode`), so a producer learns the whole
 * vocabulary from one rejection (FR2 parity).
 */
import { z } from 'zod';

/**
 * The fixed icon vocabulary. Generic and domain-neutral so a status update, an
 * incident write-up or an inventory all draw from one set: a verdict pair
 * (`check`/`cross`), the admonition glyphs (`alert`/`info`/`question`), motion
 * and time (`arrow-right`/`clock`), and a handful of object glyphs
 * (`database`/`shield`/`bolt`/`flag`/`link`). Add a name here AND its SVG in the
 * render registry together; the lockstep test fails otherwise.
 */
export const ICON_NAMES = [
	'check',
	'cross',
	'alert',
	'info',
	'question',
	'arrow-right',
	'clock',
	'database',
	'shield',
	'bolt',
	'flag',
	'link'
] as const;

export const iconNameSchema = z.enum(ICON_NAMES);

export type IconName = z.infer<typeof iconNameSchema>;
