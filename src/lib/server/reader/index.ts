/**
 * Reader verification domain (story 3.3). The public surface the `/r/[token]`
 * routes consume: email normalization, the verification-token store, the
 * identity/access-audit service, the request/complete orchestration, and the
 * neutral closed-share exit. Server-only ($lib/server boundary).
 */
export { normalizeEmail, isPlausibleEmail } from './email';
export {
	issueVerificationToken,
	consumeVerificationToken,
	peekVerificationToken,
	VERIFICATION_TOKEN_TTL_MS,
	type IssuedVerification,
	type ConsumedVerification
} from './verification';
export { findOrCreateIdentity, recordAccess, getIdentityByEmail } from './identities';
export {
	requestVerification,
	completeVerification,
	peekVerification,
	type CompletedVerification
} from './gate';
export { serveNeutralClosed } from './neutral';
