/**
 * Shared time arithmetic. The day-in-milliseconds factor was recomputed inline
 * (`24 * 60 * 60 * 1000`) across the purge sweep, the session TTLs, and the
 * reader-cookie lifetime; defining it once removes the duplicated magic number so
 * a future change (or an audit) has a single source of truth.
 */

/** Milliseconds in one day. The factor every "N days" TTL/cutoff multiplies by. */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
