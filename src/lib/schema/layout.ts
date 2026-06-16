/**
 * Document layout options (additive, Epic follow-up). Currently a single optional
 * `width`: the reader's max content width in CSS pixels. Absent means full-bleed (the
 * default - the content column fills its container up to the global 2400px ceiling);
 * a number caps the reader column at that width on `/view` and the published reader.
 *
 * Isomorphic: imports nothing from `$lib/server` / `$lib/ui`. The bounds are shared
 * with the editor's width control so the field and its input never drift.
 */
import { z } from 'zod';

/** Narrowest configurable reader width: the prose measure (~70ch) floor; below this a
 * fixed width only adds margin without lengthening a line. */
export const READER_WIDTH_MIN = 640;

/** Widest configurable reader width: the global content ceiling (`--tool-width`). */
export const READER_WIDTH_MAX = 2400;

export const readerWidthSchema = z
	.number()
	.int('Reader width must be a whole number of pixels.')
	.min(READER_WIDTH_MIN, `Reader width too small: ${READER_WIDTH_MIN}px minimum.`)
	.max(READER_WIDTH_MAX, `Reader width too large: ${READER_WIDTH_MAX}px maximum.`);
