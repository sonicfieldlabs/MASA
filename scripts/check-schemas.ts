import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { SCHEMA_ID_PREFIX, VOCAB_NAMESPACE } from "./canonical.js";

const root = resolve(import.meta.dirname, "..");
const schemaRoot = join(root, "schemas", "0.1.0");
const EXPECTED_SCHEMA_COUNT = 29;

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".schema.json"))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

function references(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(references);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [
    ...(typeof object.$ref === "string" ? [object.$ref] : []),
    ...Object.values(object).flatMap(references)
  ];
}

const files = await filesBelow(schemaRoot);
if (files.length !== EXPECTED_SCHEMA_COUNT) {
  throw new Error(
    `Expected exactly ${EXPECTED_SCHEMA_COUNT} MASA schemas; found ${files.length}. A normative schema change must update this count, the examples, the fixtures, and the changelog together.`
  );
}

const schemas = await Promise.all(
  files.map(async (path) => ({ path, schema: JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> }))
);
const ids = new Map<string, string>();
for (const { path, schema } of schemas) {
  if (typeof schema.$id !== "string" || !schema.$id.startsWith(SCHEMA_ID_PREFIX)) {
    throw new Error(`${relative(root, path)} has no stable MASA 0.1.0 $id.`);
  }
  if (ids.has(schema.$id)) throw new Error(`Duplicate schema $id ${schema.$id}.`);
  ids.set(schema.$id, path);
}

for (const { path, schema } of schemas) {
  for (const reference of references(schema)) {
    if (reference.startsWith("#")) continue;
    const externalId = new URL(reference, schema.$id as string).href.split("#", 1)[0]!;
    if (!ids.has(externalId)) {
      throw new Error(`${relative(root, path)} has an unresolved offline $ref: ${reference}`);
    }
  }
}

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  strictRequired: false,
  strictTypes: false,
  validateFormats: true
});
addFormats(ajv);
for (const { path, schema } of schemas) {
  if (!ajv.validateSchema(schema)) {
    throw new Error(`${relative(root, path)} does not meta-validate: ${ajv.errorsText(ajv.errors)}`);
  }
  ajv.addSchema(schema);
}
for (const { path, schema } of schemas) {
  try {
    ajv.getSchema(schema.$id as string) ?? ajv.compile(schema);
  } catch (error) {
    throw new Error(`${relative(root, path)} does not compile offline: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validateArtifact(schemaName: string, artifactPath: string): Promise<Record<string, unknown>> {
  const schema = schemas.find(({ path }) => path.endsWith(`${sep}${schemaName}.schema.json`))?.schema;
  if (!schema || typeof schema.$id !== "string") throw new Error(`Missing schema ${schemaName}.`);
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as Record<string, unknown>;
  const validator = ajv.getSchema(schema.$id);
  if (!validator || !validator(artifact)) {
    throw new Error(`${relative(root, artifactPath)} is invalid: ${ajv.errorsText(validator?.errors)}`);
  }
  return artifact;
}

function schemaUriReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(schemaUriReferences);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const found: string[] = [];
  if (object.state === "known" && typeof object.uri === "string") found.push(object.uri);
  for (const child of Object.values(object)) found.push(...schemaUriReferences(child));
  return found;
}

const termRegistry = await validateArtifact("term-registry", join(root, "ontology", "0.1.0", "terms.json"));
const relationRegistry = await validateArtifact("relation-registry", join(root, "ontology", "0.1.0", "relations.json"));
const capabilityCatalog = await validateArtifact("capability-set", join(root, "capabilities", "0.1.0", "reference.json"));
const jsonldContext = JSON.parse(await readFile(join(root, "contexts", "0.1.0", "masa.jsonld"), "utf8")) as Record<string, unknown>;

const contextBody = jsonldContext["@context"];
if (contextBody === null || typeof contextBody !== "object" || Array.isArray(contextBody)) {
  throw new Error("contexts/0.1.0/masa.jsonld must declare one @context object.");
}
if ((contextBody as Record<string, unknown>).masa !== VOCAB_NAMESPACE) {
  throw new Error("The JSON-LD masa prefix must equal the canonical vocabulary namespace.");
}
for (const registry of [termRegistry, relationRegistry]) {
  if (registry.namespace !== VOCAB_NAMESPACE) {
    throw new Error("An ontology registry namespace does not match the canonical vocabulary namespace.");
  }
}

// Every schema URI advertised by the capability catalog must resolve to a
// registered schema $id, so the catalog cannot silently outlive a migration.
for (const uri of schemaUriReferences(capabilityCatalog)) {
  if (uri.startsWith(SCHEMA_ID_PREFIX) && !ids.has(uri)) {
    throw new Error(`capabilities/0.1.0/reference.json names an unregistered schema URI: ${uri}`);
  }
  if (!uri.startsWith(SCHEMA_ID_PREFIX)) {
    throw new Error(`capabilities/0.1.0/reference.json names a non-canonical schema URI: ${uri}`);
  }
}

const registeredRelations = Array.isArray(relationRegistry.relations)
  ? relationRegistry.relations as Array<Record<string, unknown>>
  : [];
const relationIds = new Set(registeredRelations.map((relation) => relation.id).filter((id): id is string => typeof id === "string"));
const relationsById = new Map(
  registeredRelations
    .filter((relation): relation is Record<string, unknown> & { id: string } => typeof relation.id === "string")
    .map((relation) => [relation.id, relation]),
);
if (relationIds.size !== registeredRelations.length) throw new Error("Relation registry contains duplicate IDs.");
for (const relation of registeredRelations) {
  if (typeof relation.inverse === "string" && !relationIds.has(relation.inverse)) {
    throw new Error(`Relation ${String(relation.id)} names an unregistered inverse.`);
  }
  if (typeof relation.inverse === "string") {
    const inverse = relationsById.get(relation.inverse);
    if (inverse?.inverse !== relation.id) {
      throw new Error(`Relation ${String(relation.id)} does not have a reciprocal inverse declaration.`);
    }
    if (
      typeof relation.lineageDirection === "string" &&
      inverse.lineageDirection === relation.lineageDirection
    ) {
      throw new Error(`Inverse lineage relations ${String(relation.id)} and ${relation.inverse} use the same descendant direction.`);
    }
  }
}

process.stdout.write(`MASA schemas: ${schemas.length} meta-valid and offline-resolvable; ontology, context, and capabilities validated.\n`);
