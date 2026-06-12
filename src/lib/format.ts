/**
 * Deterministic UTC timestamp formatting shared across the workspace UI. No
 * locale and no timezone, so server and client renders never drift (avoids
 * SSR/CSR hydration mismatches on dates).
 */

/** The `HH:MM UTC` time portion of an ISO-8601 timestamp string. */
export function formatUtcTime(iso: string): string {
	return `${iso.slice(11, 16)} UTC`;
}

/** Full `YYYY-MM-DD HH:MM UTC` rendering of a Date, for list timestamps. */
export function formatUtcDateTime(date: Date): string {
	const iso = date.toISOString();
	return `${iso.slice(0, 10)} ${formatUtcTime(iso)}`;
}
