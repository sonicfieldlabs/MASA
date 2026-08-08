# Standards mappings

MASA uses external standards only at explicit boundaries.

## JSON Schema 2020-12

JSON Schema is the normative structural validation language. All `$ref` targets are versioned and registered locally. Reference tooling never retrieves a schema over the network.

## JSON-LD 1.1

The optional context maps MASA identifiers into linked-data form. An application does not need RDF storage or query support to conform. JSON-LD expansion does not change MASA claim, listening, policy, or profile semantics.

## W3C PROV-O

An export can map Representation and record entities to `prov:Entity`, OperationReceipt to `prov:Activity`, Actor to `prov:Agent`, inputs to `prov:used`, outputs to `prov:generated`, and attribution to `prov:wasAttributedTo`. MASA retains claim kinds, listening apertures, reversibility, mappings, disclosure, and profile semantics not supplied by PROV-O alone.

## W3C ODRL 2.2

MASA Policy rules can export permissions, prohibitions, duties, assignees, targets, and constraints to ODRL. Consent, community authority, jurisdiction, covenant, ethical legitimacy, and runtime authority remain separate MASA concerns.

## Model Context Protocol

MCP is an optional capability and resource transport. It does not define MASA's ontology, evidence, policy, or authorization. The local reference server pins the supported v1 TypeScript SDK line and negotiates the protocol version with its host. No record can grant itself MCP authority.

