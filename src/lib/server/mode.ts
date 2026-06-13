import { serverEnv } from '$lib/server/env';

/**
 * Operating mode (Epic 8, story 8.1). The instance runs in one of two modes,
 * chosen ENTIRELY by the SMTP environment at boot - never a runtime web action:
 *
 * - `single` (SMTP absent): one password author (`AUTHOR_PASSWORD_HASH`) and
 *   unverified consultation-token reader shares. Today's behavior.
 * - `multi` (SMTP configured): authors authenticate by email magic link within
 *   `AUTHOR_EMAIL_DOMAIN`, the password login is disabled, and reader shares use
 *   the verified magic-link flow.
 *
 * This module is the SINGLE source of truth the auth, sharing, and UI layers
 * (stories 8.2-8.6) branch on. It is pure: it derives the mode from the cached,
 * already-validated env (the all-or-nothing SMTP refine guarantees a present
 * `SMTP_HOST` implies a complete, multi-mode-valid config), so no separate
 * "mode" variable can drift from the SMTP configuration.
 */
export type OperatingMode = 'single' | 'multi';

/** Resolves the operating mode from the SMTP configuration in the cached env. */
export function operatingMode(): OperatingMode {
	return serverEnv().SMTP_HOST ? 'multi' : 'single';
}

/** True when the instance runs multi-author (email magic-link) mode. */
export function isMultiAuthor(): boolean {
	return operatingMode() === 'multi';
}
