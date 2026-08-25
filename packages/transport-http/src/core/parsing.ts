import { AppError } from "@guild/kernel";
import type { FileUpload, ImageUpload } from "@guild/server/modules/media";
import {
  LIMITS,
  MAX_CONFIGURABLE_ATTACHMENT_BYTES,
  MAX_CONFIGURABLE_AUDIO_BYTES,
  MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES,
} from "@guild/shared";
import { z } from "zod";
import { assertRequestBodyLength, HttpPayloadTooLargeError, readBodyBytes } from "./body-limit.js";

const MAX_MULTIPART_PARTS = 150;
const MAX_MULTIPART_HEADER_BYTES = 16 * 1024;
const CRLF = new Uint8Array([13, 10]);
const textDecoder = new TextDecoder();

export type MultipartFilePart = Readonly<{
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  size: number;
  type: string;
}>;

export type MultipartFormValue = string | MultipartFilePart;

export interface ParsedMultipartForm extends Iterable<readonly [string, MultipartFormValue]> {
  get(name: string): MultipartFormValue | null;
  getAll(name: string): readonly MultipartFormValue[];
}

export type MultipartParseOptions = Readonly<{
  /** Reports the parser's current-part working set; completed form values are excluded. */
  observeTransientBytes?(bytes: number): void;
}>;

export async function parseJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  message = "Invalid JSON payload",
): Promise<z.output<TSchema>> {
  let value: unknown;
  try {
    const bytes = await readBodyBytes(request, LIMITS.requestBody.ordinary);
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch (cause) {
    if (cause instanceof HttpPayloadTooLargeError || cause instanceof AppError) throw cause;
    throw validation(message, undefined, cause);
  }
  return parseValue(value, schema, message);
}

export function parseQuery<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  message = "Invalid query parameters",
): z.output<TSchema> {
  const values: Record<string, string | string[]> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    const existing = values[key];
    values[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return parseValue(values, schema, message);
}

export async function parseFormData(
  request: Request,
  options: MultipartParseOptions = {},
): Promise<ParsedMultipartForm> {
  const contentType = request.headers.get("Content-Type") ?? "";
  const boundary = multipartBoundary(contentType);
  const expectedLength = assertRequestBodyLength(request, LIMITS.requestBody.upload);
  if (!request.body) throw validation("Invalid multipart form data");
  const stream = new MultipartStreamReader(
    request.body.getReader(),
    LIMITS.requestBody.upload,
    options.observeTransientBytes,
  );
  try {
    const form = await parseMultipart(stream, boundary);
    stream.assertComplete(expectedLength);
    return form;
  } catch (cause) {
    await stream.cancel().catch(() => undefined);
    if (cause instanceof HttpPayloadTooLargeError || cause instanceof AppError) throw cause;
    throw validation("Invalid multipart form data", undefined, cause);
  } finally {
    stream.releaseLock();
  }
}

export async function parseImageUploads(form: ParsedMultipartForm | FormData): Promise<readonly ImageUpload[]> {
  const full = form.getAll("full");
  const view = form.getAll("view");
  if (full.length !== view.length) throw validation("Image full and view variants must be aligned");
  if (full.length < 1 || full.length > 50 || view.length < 1 || view.length > 50) {
    throw validation("Invalid image upload form");
  }

  for (const part of [...full, ...view]) {
    if (!isMultipartFilePart(part) && !(part instanceof Blob)) throw validation("Invalid image upload form");
    if (part.type !== "image/webp") throw validation("Image variants must use image/webp");
    if (part.size > MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES) {
      throw new HttpPayloadTooLargeError(MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES);
    }
  }

  const uploads: ImageUpload[] = [];
  for (let index = 0; index < full.length; index += 1) {
    uploads.push({
      full: await fileBytes(full[index]!),
      view: await fileBytes(view[index]!),
    });
  }
  return uploads;
}

export async function parseAnnouncementAttachment(form: ParsedMultipartForm | FormData): Promise<FileUpload> {
  const files = form.getAll("file");
  if (files.length !== 1) throw validation("Announcement attachment uploads require exactly one file");
  const file = files[0];
  if (!file || (!isMultipartFilePart(file) && !(file instanceof File))) {
    throw validation("Invalid announcement attachment upload");
  }
  if (file.size > MAX_CONFIGURABLE_ATTACHMENT_BYTES) {
    throw new HttpPayloadTooLargeError(MAX_CONFIGURABLE_ATTACHMENT_BYTES);
  }
  return {
    bytes: await fileBytes(file),
    originalName: isMultipartFilePart(file) ? file.filename : file.name,
    contentType: file.type,
  };
}

export function isMultipartFilePart(value: unknown): value is MultipartFilePart {
  return typeof value === "object"
    && value !== null
    && "bytes" in value
    && value.bytes instanceof Uint8Array
    && "filename" in value
    && typeof value.filename === "string"
    && "size" in value
    && typeof value.size === "number"
    && "type" in value
    && typeof value.type === "string";
}

export function parseIfMatch(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return !normalized || normalized === "*" ? undefined : normalized;
}

export function parseValue<TSchema extends z.ZodType>(
  value: unknown,
  schema: TSchema,
  message: string,
): z.output<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validation(message, parsed.error.flatten());
  return parsed.data;
}

export function validation(message: string, details?: unknown, cause?: unknown): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    status: 400,
    message,
    ...(details === undefined ? {} : { details }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function multipartBoundary(contentType: string): string {
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > 70 || !/^[\x20-\x7e]+$/.test(boundary) || boundary.endsWith(" ")) {
    throw validation("Invalid multipart boundary");
  }
  return boundary;
}

async function parseMultipart(
  stream: MultipartStreamReader,
  boundary: string,
): Promise<ParsedMultipartForm> {
  const delimiter = new TextEncoder().encode(`--${boundary}`);
  const closingDelimiter = new TextEncoder().encode(`--${boundary}--`);
  const marker = new Uint8Array(delimiter.byteLength + 2);
  marker.set(CRLF);
  marker.set(delimiter, 2);
  const firstLine = await stream.readLine(closingDelimiter.byteLength);
  if (equalBytes(firstLine, closingDelimiter)) {
    await requireMultipartEnd(stream);
    return multipartForm([]);
  }
  if (!equalBytes(firstLine, delimiter)) throw validation("Invalid multipart body");

  const entries: Array<readonly [string, MultipartFormValue]> = [];
  while (true) {
    if (entries.length >= MAX_MULTIPART_PARTS) {
      throw validation(`Multipart form supports at most ${MAX_MULTIPART_PARTS} parts`);
    }
    const headerLines: string[] = [];
    let headerBytes = 0;
    while (true) {
      const line = await stream.readLine(MAX_MULTIPART_HEADER_BYTES - headerBytes);
      headerBytes += line.byteLength + CRLF.byteLength;
      if (headerBytes > MAX_MULTIPART_HEADER_BYTES) throw validation("Invalid multipart headers");
      if (line.byteLength === 0) break;
      headerLines.push(textDecoder.decode(line));
    }
    const { name, filename, type } = parsePartHeaders(headerLines);
    const partLimit = name === "full" || name === "view"
      ? MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES
      : name === "file"
        ? MAX_CONFIGURABLE_AUDIO_BYTES
        : LIMITS.requestBody.upload;
    const bytes = await stream.readPart(marker, partLimit);
    entries.push([name, filename === null
      ? textDecoder.decode(bytes)
      : { bytes, filename, size: bytes.byteLength, type }]);
    const suffix = await stream.readExact(2);
    if (equalBytes(suffix, CRLF)) continue;
    if (suffix[0] === 45 && suffix[1] === 45) {
      await requireMultipartEnd(stream);
      return multipartForm(entries);
    }
    throw validation("Invalid multipart body");
  }
}

async function requireMultipartEnd(stream: MultipartStreamReader): Promise<void> {
  const trailing = await stream.readRemainder(CRLF.byteLength);
  if (trailing.byteLength !== 0 && !equalBytes(trailing, CRLF)) throw validation("Invalid multipart body");
}

function multipartForm(entries: readonly (readonly [string, MultipartFormValue])[]): ParsedMultipartForm {
  return {
    get(name) {
      return entries.find(([key]) => key === name)?.[1] ?? null;
    },
    getAll(name) {
      return entries.filter(([key]) => key === name).map(([, value]) => value);
    },
    [Symbol.iterator]() {
      return entries[Symbol.iterator]();
    },
  };
}

function parsePartHeaders(lines: readonly string[]): Readonly<{
  name: string;
  filename: string | null;
  type: string;
}> {
  const headers = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) throw validation("Invalid multipart headers");
    const name = line.slice(0, separator).trim().toLowerCase();
    if (!name || headers.has(name)) throw validation("Invalid multipart headers");
    headers.set(name, line.slice(separator + 1).trim());
  }

  const disposition = headers.get("content-disposition");
  if (!disposition || !/^form-data(?:\s*;|$)/i.test(disposition)) {
    throw validation("Invalid multipart content disposition");
  }
  const name = quotedParameter(disposition, "name");
  if (name === null || name.length === 0) throw validation("Invalid multipart field name");
  return {
    name,
    filename: quotedParameter(disposition, "filename"),
    type: (headers.get("content-type") ?? "application/octet-stream").toLowerCase(),
  };
}

function quotedParameter(value: string, parameter: "name" | "filename"): string | null {
  const match = new RegExp(`(?:^|;)\\s*${parameter}\\s*=\\s*"((?:\\\\.|[^"])*)"`, "i").exec(value);
  return match ? match[1]!.replace(/\\(.)/g, "$1") : null;
}

async function fileBytes(value: MultipartFormValue | FormDataEntryValue): Promise<Uint8Array> {
  if (isMultipartFilePart(value)) return value.bytes;
  return new Uint8Array(await (value as Blob).arrayBuffer());
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, start: number): number {
  const last = haystack.byteLength - needle.byteLength;
  outer: for (let index = start; index <= last; index += 1) {
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let offset = 0; offset < left.byteLength; offset += 1) {
    if (left[offset] !== right[offset]) return false;
  }
  return true;
}

class MultipartStreamReader {
  private buffer = new Uint8Array(new ArrayBuffer(0));
  private totalBytes = 0;
  private done = false;

  constructor(
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
    private readonly totalLimit: number,
    private readonly observeTransientBytes: ((bytes: number) => void) | undefined,
  ) {}

  async readLine(maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
    if (maxBytes < 0) throw validation("Invalid multipart headers");
    while (true) {
      const lineEnd = indexOfBytes(this.buffer, CRLF, 0);
      if (lineEnd >= 0) {
        if (lineEnd > maxBytes) throw validation("Invalid multipart headers");
        const line = Uint8Array.from(this.buffer.subarray(0, lineEnd));
        this.consume(lineEnd + CRLF.byteLength);
        return line;
      }
      if (this.buffer.byteLength > maxBytes + CRLF.byteLength || !await this.fill()) {
        throw validation("Invalid multipart body");
      }
    }
  }

  async readPart(marker: Uint8Array, limit: number): Promise<Uint8Array<ArrayBuffer>> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const append = (chunk: Uint8Array) => {
      if (chunk.byteLength === 0) return;
      if (size + chunk.byteLength > limit) throw new HttpPayloadTooLargeError(limit);
      chunks.push(chunk);
      size += chunk.byteLength;
      this.report(size);
    };

    while (true) {
      const candidate = indexOfBytes(this.buffer, marker, 0);
      if (candidate >= 0) {
        append(this.buffer.subarray(0, candidate));
        this.consume(candidate);
        while (this.buffer.byteLength < marker.byteLength + 2) {
          if (!await this.fill()) throw validation("Invalid multipart body");
        }
        const suffixOffset = marker.byteLength;
        const validSuffix = (this.buffer[suffixOffset] === 45 && this.buffer[suffixOffset + 1] === 45)
          || (this.buffer[suffixOffset] === 13 && this.buffer[suffixOffset + 1] === 10);
        if (validSuffix) {
          this.consume(marker.byteLength);
          this.report(size * 2);
          const bytes = new Uint8Array(new ArrayBuffer(size));
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          return bytes;
        }
        append(this.buffer.subarray(0, 1));
        this.consume(1);
        continue;
      }

      const safeBytes = this.buffer.byteLength - Math.max(0, marker.byteLength - 1);
      if (safeBytes > 0) {
        append(this.buffer.subarray(0, safeBytes));
        this.consume(safeBytes);
      }
      if (!await this.fill()) {
        append(this.buffer);
        this.consume(this.buffer.byteLength);
        throw validation("Invalid multipart body");
      }
    }
  }

  async readExact(length: number): Promise<Uint8Array<ArrayBuffer>> {
    while (this.buffer.byteLength < length) {
      if (!await this.fill()) throw validation("Invalid multipart body");
    }
    const value = Uint8Array.from(this.buffer.subarray(0, length));
    this.consume(length);
    return value;
  }

  async readRemainder(limit: number): Promise<Uint8Array<ArrayBuffer>> {
    while (!this.done) {
      if (this.buffer.byteLength > limit || !await this.fill()) break;
    }
    if (this.buffer.byteLength > limit) throw validation("Invalid multipart body");
    const value = Uint8Array.from(this.buffer);
    this.consume(this.buffer.byteLength);
    return value;
  }

  assertComplete(expectedLength: number | null): void {
    if (!this.done || this.buffer.byteLength !== 0) throw validation("Invalid multipart body");
    if (expectedLength !== null && this.totalBytes !== expectedLength) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Invalid Content-Length header" });
    }
  }

  cancel(): Promise<void> {
    return this.reader.cancel();
  }

  releaseLock(): void {
    this.reader.releaseLock();
  }

  private async fill(): Promise<boolean> {
    if (this.done) return false;
    const next = await this.reader.read();
    if (next.done) {
      this.done = true;
      return false;
    }
    this.totalBytes += next.value.byteLength;
    if (this.totalBytes > this.totalLimit) throw new HttpPayloadTooLargeError(this.totalLimit);
    const incoming = Uint8Array.from(next.value);
    if (this.buffer.byteLength === 0) this.buffer = incoming;
    else {
      const combined = new Uint8Array(new ArrayBuffer(this.buffer.byteLength + incoming.byteLength));
      combined.set(this.buffer);
      combined.set(incoming, this.buffer.byteLength);
      this.buffer = combined;
    }
    this.report(0);
    return true;
  }

  private consume(length: number): void {
    this.buffer = this.buffer.subarray(length) as Uint8Array<ArrayBuffer>;
  }

  private report(partBytes: number): void {
    this.observeTransientBytes?.(partBytes + this.buffer.byteLength);
  }
}
