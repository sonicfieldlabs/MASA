# MASA adapter contracts

Adapters translate application objects into MASA records and back without changing the meaning or authority of either side. They are mappings, not claims that application terms are equivalent to Core terms.

The documents in this directory are illustrative archetypes for common integration shapes. Their namespaces are placeholders: a real application chooses and governs its own namespace, documents its own adapter in its own repository, and never becomes a MASA conformance dependency.

Every adapter must document:

1. the application and MASA versions it supports;
2. the exact profiles it reads and writes;
3. field and vocabulary mappings, including non-equivalences;
4. which application data remains under its extension namespace;
5. loss, default, unknown, and withheld behavior;
6. identity and lineage preservation;
7. policy and runtime-authority boundaries;
8. ordinary round-trip and public-projection tests.

Adapters must preserve unknown MASA extensions during local round trips. They must never turn missing, stale, refused, or unknown input into a measured zero. Import access does not grant transformation, provider, training, or publication permission.
