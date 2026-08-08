export type MasaId = `urn:uuid:${string}`;

/** Generate a globally unique MASA identifier without depending on Node APIs. */
export function generateId(): MasaId {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi === undefined || typeof cryptoApi.randomUUID !== "function") {
    throw new Error("MASA_ID_CRYPTO_UNAVAILABLE: crypto.randomUUID() is required");
  }

  return `urn:uuid:${cryptoApi.randomUUID()}`;
}
