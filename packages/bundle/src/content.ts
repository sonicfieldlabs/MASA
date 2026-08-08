import { Buffer } from "node:buffer";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import {
  parseJsonStrict,
  type Diagnostic,
  type MatterRecord,
  type OperationReceipt
} from "@sonicfield/masa";
import {
  validateOperationReceipt,
  validateMatterRecord
} from "@sonicfield/masa-validator";
import type { BundleLimits } from "./types.js";
import { BundleOperationError } from "./types.js";
import { diagnostic, sha256Hex, strictJsonDiagnostic } from "./safety.js";

export interface ConsumedContent {
  readonly byteLength: number;
  readonly sha256: string;
}

export async function consumeReadable(
  input: NodeJS.ReadableStream,
  maxBytes: number,
  onChunk?: (chunk: Buffer) => void | Promise<void>,
  limitCode = "MASA_BUNDLE_ENTRY_LIMIT"
): Promise<ConsumedContent> {
  const readable = input instanceof Readable ? input : Readable.from(input);
  const hash = sha256Hex();
  let byteLength = 0;

  for await (const value of readable) {
    const chunk = Buffer.isBuffer(value)
      ? value
      : typeof value === "string"
        ? Buffer.from(value)
        : Buffer.from(value as Uint8Array);
    byteLength += chunk.byteLength;
    if (byteLength > maxBytes) {
      readable.destroy();
      throw new BundleOperationError(
        limitCode,
        "An included file exceeds the configured uncompressed byte limit."
      );
    }
    hash.update(chunk);
    await onChunk?.(chunk);
  }

  return { byteLength, sha256: hash.digest("hex") };
}

export async function readFileBounded(path: string, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await consumeReadable(createReadStream(path), maxBytes, (chunk) => {
    chunks.push(chunk);
  });
  return Buffer.concat(chunks);
}

export interface RecordValidation {
  readonly diagnostics: readonly Diagnostic[];
  readonly record?: MatterRecord;
}

export function validateRecordBuffer(buffer: Buffer, instancePath: string): RecordValidation {
  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    parsed = parseJsonStrict(text);
  } catch (error) {
    return {
      diagnostics: [
        strictJsonDiagnostic(
          error,
          "MASA_BUNDLE_RECORD_INVALID_JSON",
          "A record entry must contain one duplicate-key-free UTF-8 JSON object.",
          instancePath
        )
      ]
    };
  }

  const result = validateMatterRecord(parsed);
  const diagnostics = result.diagnostics.map((value) => prefixDiagnostic(value, instancePath));
  if (result.valid && result.value !== undefined) {
    return { diagnostics, record: result.value };
  }
  return { diagnostics };
}

/** The bounded slice of a receipt retained for cross-file closure checks. */
export interface ReceiptClosureView {
  readonly id: string;
  readonly recordId: string;
}

export class NdjsonReceiptValidator {
  readonly diagnostics: Diagnostic[] = [];
  readonly receipts: ReceiptClosureView[] = [];
  readonly #limits: BundleLimits;
  readonly #instancePath: string;
  readonly #ids = new Set<string>();
  #pending = Buffer.alloc(0);
  #lineIndex = 0;
  #previousSequence: number | undefined;
  #discardingLongLine = false;

  constructor(limits: BundleLimits, instancePath: string) {
    this.#limits = limits;
    this.#instancePath = instancePath;
  }

  push(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.byteLength) {
      const newline = chunk.indexOf(0x0a, offset);
      if (newline === -1) {
        this.#append(chunk.subarray(offset));
        return;
      }
      this.#append(chunk.subarray(offset, newline));
      this.#completeLine();
      offset = newline + 1;
    }
  }

  finish(): void {
    if (this.#discardingLongLine || this.#pending.byteLength > 0) {
      this.diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_EVENT_PARTIAL_FINAL_LINE",
          "events.ndjson must end after a complete newline-delimited receipt.",
          `${this.#instancePath}/${this.#lineIndex}`
        )
      );
    }
  }

  #append(value: Buffer): void {
    if (this.#discardingLongLine || value.byteLength === 0) {
      return;
    }
    if (this.#pending.byteLength + value.byteLength > this.#limits.maxNdjsonLineBytes) {
      this.#discardingLongLine = true;
      this.#pending = Buffer.alloc(0);
      this.diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_EVENT_LINE_LIMIT",
          "An events.ndjson line exceeds the configured byte limit.",
          `${this.#instancePath}/${this.#lineIndex}`
        )
      );
      return;
    }
    this.#pending = Buffer.concat([this.#pending, value]);
  }

  #completeLine(): void {
    if (this.#discardingLongLine) {
      this.#discardingLongLine = false;
      this.#pending = Buffer.alloc(0);
      this.#lineIndex += 1;
      return;
    }

    let line = this.#pending;
    this.#pending = Buffer.alloc(0);
    if (line.at(-1) === 0x0d) {
      line = line.subarray(0, -1);
    }
    const path = `${this.#instancePath}/${this.#lineIndex}`;
    this.#lineIndex += 1;

    if (line.byteLength === 0) {
      this.diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_EVENT_BLANK_LINE",
          "Blank lines are not permitted in events.ndjson.",
          path
        )
      );
      return;
    }

    let parsed: unknown;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(line);
      parsed = parseJsonStrict(text);
    } catch (error) {
      this.diagnostics.push(
        strictJsonDiagnostic(
          error,
          "MASA_BUNDLE_EVENT_INVALID_JSON",
          "Each events.ndjson line must contain one duplicate-key-free UTF-8 JSON object.",
          path
        )
      );
      return;
    }

    const result = validateOperationReceipt(parsed);
    this.diagnostics.push(...result.diagnostics.map((value) => prefixDiagnostic(value, path)));
    if (!result.valid || result.value === undefined) {
      return;
    }
    this.receipts.push({ id: result.value.id, recordId: result.value.recordId });
    this.#validateOrder(result.value, path);
  }

  #validateOrder(receipt: OperationReceipt, path: string): void {
    if (this.#ids.has(receipt.id)) {
      this.diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_EVENT_DUPLICATE_ID",
          "Event receipt identifiers must be unique within events.ndjson.",
          path
        )
      );
    }
    this.#ids.add(receipt.id);

    if (this.#previousSequence !== undefined && receipt.sequence <= this.#previousSequence) {
      this.diagnostics.push(
        diagnostic(
          "MASA_BUNDLE_EVENT_SEQUENCE",
          "Event receipt sequence values must be unique and strictly increasing.",
          path
        )
      );
    }
    this.#previousSequence = receipt.sequence;
  }
}

function prefixDiagnostic(value: Diagnostic, prefix: string): Diagnostic {
  return {
    ...value,
    instancePath: `${prefix}${value.instancePath}`
  };
}
