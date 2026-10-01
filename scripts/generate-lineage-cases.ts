/** Deterministic adversarial records shared by source, packed and owner-boundary checks. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const original = JSON.parse(await readFile(resolve(root, "examples/0.2.0/valid/transformation.masa.json"), "utf8"));
type Case = { name: string; valid: boolean; codes: string[]; record: typeof original };
const cases: Case[] = [];
function add(name: string, valid: boolean, mutate: (record: typeof original) => void, codes: string[] = []) {
  const record = structuredClone(original);
  mutate(record);
  cases.push({ name, valid, codes, record });
}
const event = (record: typeof original) => record.history.events[0];
add("completed", true, () => {});
add("read-capture-provenance", true, (r) => {
  r.profiles = r.profiles.filter((profile: string) => profile !== "transformation");
  event(r).operationType = "matter.capture"; event(r).effectClass = "read";
  r.relations[0].predicate = "masa:captured-from";
});
for (const predicate of ["masa:derivation-of", "masa:parent-of"]) {
  add(`inverse-${predicate.split(":")[1]}`, true, (r) => {
    r.relations[0].predicate = predicate;
    [r.relations[0].subject, r.relations[0].object] = [r.relations[0].object, r.relations[0].subject];
  });
}
for (const status of ["failed", "refused", "cancelled", "not_performed", "undetermined"]) {
  add(`${status}-claims-descendant`, false, (r) => {
    event(r).finalStatus = status; event(r).outputs = [];
  }, ["MASA_DESCENDANT_CAUSALITY"]);
  add(`${status}-without-descendant`, true, (r) => {
    event(r).finalStatus = status; event(r).outputs = [];
    delete event(r).parameters.preservationIntent;
    r.representations = r.representations.slice(0, 1); r.relations = [];
    event(r).policyEvaluation.targets = [r.representations[0].id];
  });
}
add("partial-with-produced-descendant", true, (r) => { event(r).finalStatus = "partial"; });
add("partial-output-without-authority", false, (r) => {
  event(r).finalStatus = "partial"; event(r).policyEvaluation.result = "prohibited";
}, ["MASA_POLICY_DENIED"]);
add("partial-without-output", true, (r) => {
  event(r).finalStatus = "partial"; event(r).outputs = [];
  r.representations = r.representations.slice(0, 1); r.relations = [];
    event(r).policyEvaluation.targets = [r.representations[0].id];
});
add("partial-fabricates-descendant", false, (r) => {
  event(r).finalStatus = "partial"; event(r).outputs = [];
}, ["MASA_DESCENDANT_CAUSALITY"]);
add("undetermined-with-output", false, (r) => { event(r).finalStatus = "undetermined"; }, ["MASA_DESCENDANT_CAUSALITY"]);
add("wrong-output", false, (r) => { event(r).outputs = [r.actors[0].id]; }, ["MASA_DESCENDANT_CAUSALITY"]);
add("wrong-parent-input", false, (r) => { event(r).inputs = [r.actors[0].id]; }, ["MASA_DESCENDANT_CAUSALITY"]);
add("non-generating-effect", false, (r) => { event(r).effectClass = "read"; }, ["MASA_DESCENDANT_CAUSALITY"]);
add("missing-operation", false, (r) => { delete r.relations[0].operationRef; }, ["MASA_DESCENDANT_RECEIPT"]);
add("inverse-wrong-parent", false, (r) => {
  r.relations[0].predicate = "masa:parent-of";
  [r.relations[0].subject, r.relations[0].object] = [r.relations[0].object, r.relations[0].subject];
  event(r).inputs = [r.actors[0].id];
}, ["MASA_DESCENDANT_CAUSALITY"]);
add("completed-operation-without-profile-or-preservation", false, (r) => {
  r.profiles = r.profiles.filter((profile: string) => profile !== "transformation");
  delete event(r).parameters.preservationIntent;
}, ["MASA_PROFILE_MISMATCH"]);
for (const field of ["preservationIntent", "properties", "verification", "outputs"]) {
  const remove = (r: typeof original) => {
    if (field === "preservationIntent") delete event(r).parameters.preservationIntent;
    else if (field === "outputs") event(r).outputs = [];
    else delete event(r).parameters.preservationIntent[field];
  };
  add(`completed-missing-${field}`, false, remove, ["MASA_PROFILE_MISMATCH"]);
  add(`mixed-valid-and-missing-${field}`, false, (r) => {
    const valid = structuredClone(event(r)); remove(r);
    const malformed = event(r); malformed.id = "urn:uuid:00000000-0000-4000-8000-000000000998"; malformed.sequence = 1;
    r.history.events = [valid, malformed];
  }, ["MASA_PROFILE_MISMATCH"]);
}
await writeFile(resolve(root, "examples/0.2.0/lineage-cases.json"), JSON.stringify(cases, null, 2) + "\n");
