/**
 * Sharing domain barrel (FR17-21): share-link creation with an optional expiry,
 * the management read side, and token-by-hash resolution for the reader gate.
 */
export {
	createShare,
	listShares,
	getShareByToken,
	shareStatus,
	isExpired,
	shareUrl
} from './shares.ts';
export type {
	CreatedShare,
	CreateShareInput,
	ResolvedShare,
	ShareMode,
	ShareStatus,
	ShareSummary
} from './shares.ts';

export { generateShareToken, hashShareToken, SHARE_TOKEN_BYTES } from './tokens.ts';
