export type {
  BundleManifest,
  Capability,
  CapabilitySet,
  MatterRecord,
  OperationReceipt,
} from "./generated/index.js";
export { protocolResources, referenceCapabilitySet } from "./generated/protocol-resources.js";
export {
  acyclicRelationOrientations,
  acyclicRelationPredicates,
  lineageRelationDirections,
  relationRegistry,
} from "./generated/ontology.js";

export type { Diagnostic, DiagnosticSeverity, ValidationResult } from "./diagnostics.js";
export {
  compareDiagnostics,
  hasErrorDiagnostics,
  sortDiagnostics,
} from "./diagnostics.js";
export type { MasaId } from "./id.js";
export { generateId } from "./id.js";
export type {
  LineageDirection,
  LineageTrace,
  LineageTraceNode,
  LineageTraceOptions,
} from "./lineage.js";
export { LineageTraceError, traceLineage } from "./lineage.js";
export type { JsonPrimitive, JsonValue } from "./json.js";
export {
  cloneJson,
  escapeJsonPointerSegment,
  parseJsonStrict,
  stableStringify,
  StrictJsonError,
} from "./json.js";
export type {
  DuplicateIdentity,
  IndexedEntity,
  RecordEntityCollection,
  RecordIndex,
  RecordSummary,
} from "./index-record.js";
export {
  indexRecord,
  RECORD_ENTITY_COLLECTIONS,
  summarizeRecord,
} from "./index-record.js";
export type {
  ProjectionNotice,
  PublicProjectionOptions,
  PublicProjectionReport,
  PublicProjectionResult,
} from "./public-projection.js";
export {
  createPublicProjection,
  isPrivateHostname,
  PublicProjectionError,
} from "./public-projection.js";
export type { JsonVisit, JsonVisitor } from "./traversal.js";
export {
  asJsonArray,
  collectJsonStrings,
  isJsonObject,
  readString,
  readStringArray,
  walkJson,
} from "./traversal.js";
