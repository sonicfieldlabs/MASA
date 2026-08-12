/**
 * The single source of truth for the canonical MASA identifier root.
 * Generators mint identifiers from these constants and check-schemas
 * verifies them, so a host migration is a one-line change here plus a
 * regeneration rather than a scattered manual rename.
 */
export const MASA_PROTOCOL_VERSION = "0.2.0";
export const CANONICAL_ROOT = "https://masa.sonicfield.org/";
export const SCHEMA_ID_PREFIX = `${CANONICAL_ROOT}schemas/${MASA_PROTOCOL_VERSION}/`;
export const CAPABILITY_ID_PREFIX = `${CANONICAL_ROOT}capabilities/${MASA_PROTOCOL_VERSION}/`;
export const IMPLEMENTATION_ID_PREFIX = `${CANONICAL_ROOT}implementations/`;
export const VOCAB_NAMESPACE = `${CANONICAL_ROOT}vocab/${MASA_PROTOCOL_VERSION}#`;
