/**
 * The single source of truth for the canonical MASA identifier root.
 * Generators mint identifiers from these constants and check-schemas
 * verifies them, so a host migration is a one-line change here plus a
 * regeneration rather than a scattered manual rename.
 */
export const CANONICAL_ROOT = "https://masa.sonicfield.org/";
export const SCHEMA_ID_PREFIX = `${CANONICAL_ROOT}schemas/0.1.0/`;
export const CAPABILITY_ID_PREFIX = `${CANONICAL_ROOT}capabilities/0.1.0/`;
export const IMPLEMENTATION_ID_PREFIX = `${CANONICAL_ROOT}implementations/`;
export const VOCAB_NAMESPACE = `${CANONICAL_ROOT}vocab/0.1.0#`;
