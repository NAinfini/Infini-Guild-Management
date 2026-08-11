import type {
  BlobManifestDescriptor,
  BlobReconciliationFinding,
  BlobReconciliationPage,
} from "@guild/server/modules/blob-reconciliation";
import {
  blobReconciliationResponseSchema,
  type BlobReconciliationResponse,
} from "@guild/shared";
import type { BlobMetadata } from "@guild/kernel";

export function presentBlobReconciliationPage(page: BlobReconciliationPage): BlobReconciliationResponse {
  return blobReconciliationResponseSchema.parse({
    status: page.nextCheckpoint ? "incomplete" : page.findings.length > 0 ? "drift" : "clean",
    scanned: page.scanned,
    findings: page.findings.map(presentFinding),
    next_checkpoint: page.nextCheckpoint ?? null,
  });
}

function presentFinding(finding: BlobReconciliationFinding) {
  if (finding.kind === "missing_blob") {
    return { kind: finding.kind, expected: presentDescriptor(finding.expected) };
  }
  if (finding.kind === "orphan_candidate") {
    return { kind: finding.kind, actual: presentMetadata(finding.actual) };
  }
  return {
    kind: finding.kind,
    expected: presentDescriptor(finding.expected),
    actual: presentMetadata(finding.actual),
  };
}

function presentDescriptor(value: BlobManifestDescriptor) {
  return {
    source: value.source,
    source_id: value.sourceId,
    object_key: value.objectKey,
    byte_size: value.byteSize,
    content_type: value.contentType,
    sha256: value.sha256,
  };
}

function presentMetadata(value: BlobMetadata) {
  return {
    object_key: value.key,
    byte_size: value.size,
    content_type: value.contentType,
    sha256: value.sha256,
    etag: value.etag,
    last_modified: value.lastModified,
  };
}
