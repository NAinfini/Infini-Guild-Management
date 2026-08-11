import type { BlobInventory, BlobMetadata, BlobStore } from "@guild/kernel";

const MANAGED_PREFIXES = ["media/", "audit/"] as const;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 50;
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1_000;
const HEAD_CONCURRENCY = 4;

export type BlobManifestDescriptor = Readonly<{
  source: "media" | "audit";
  sourceId: string;
  objectKey: string;
  byteSize: number;
  contentType: string;
  sha256: string;
}>;

export type BlobManifestPage = Readonly<{
  descriptors: readonly BlobManifestDescriptor[];
  nextCheckpoint: string | null;
}>;

export interface BlobManifestStore {
  listPage(request: Readonly<{ checkpoint?: string; limit: number }>): Promise<BlobManifestPage>;
  findByObjectKeys(objectKeys: readonly string[]): Promise<readonly BlobManifestDescriptor[]>;
}

export type BlobReconciliationCheckpoint =
  | Readonly<{ phase: "manifest"; checkpoint?: string }>
  | Readonly<{
    phase: "inventory";
    prefix: typeof MANAGED_PREFIXES[number];
    checkpoint?: string;
  }>;

export type BlobReconciliationFinding =
  | Readonly<{ kind: "missing_blob"; expected: BlobManifestDescriptor }>
  | Readonly<{
    kind: "metadata_mismatch";
    expected: BlobManifestDescriptor;
    actual: BlobMetadata;
  }>
  | Readonly<{ kind: "orphan_candidate"; actual: BlobMetadata }>;

export type BlobReconciliationPage = Readonly<{
  scanned: number;
  findings: readonly BlobReconciliationFinding[];
  nextCheckpoint: BlobReconciliationCheckpoint | null;
}>;

/** Read-only verifier. Its dependencies intentionally expose no delete operation. */
export class BlobReconciliationService {
  constructor(
    private readonly manifests: BlobManifestStore,
    private readonly blobs: Pick<BlobStore, "head">,
    private readonly inventory: BlobInventory,
  ) {}

  async scanPage(input: Readonly<{
    now: string;
    checkpoint?: BlobReconciliationCheckpoint;
    limit?: number;
  }>): Promise<BlobReconciliationPage> {
    const now = Date.parse(input.now);
    if (!Number.isFinite(now) || new Date(now).toISOString() !== input.now) {
      throw new TypeError("Blob reconciliation time must be an ISO timestamp");
    }
    const limit = input.limit ?? DEFAULT_PAGE_SIZE;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new RangeError(`Blob reconciliation limit must be between 1 and ${MAX_PAGE_SIZE}`);
    }
    const checkpoint = input.checkpoint ?? { phase: "manifest" };
    return checkpoint.phase === "manifest"
      ? this.scanManifestPage(checkpoint.checkpoint, limit)
      : this.scanInventoryPage(checkpoint, limit, new Date(now - ORPHAN_GRACE_MS).toISOString());
  }

  private async scanManifestPage(checkpoint: string | undefined, limit: number): Promise<BlobReconciliationPage> {
    const page = await this.manifests.listPage({ ...(checkpoint ? { checkpoint } : {}), limit });
    const actual = await mapLimited(page.descriptors, HEAD_CONCURRENCY, ({ objectKey }) => this.blobs.head(objectKey));
    const findings: BlobReconciliationFinding[] = [];
    page.descriptors.forEach((expected, index) => {
      const metadata = actual[index] ?? null;
      if (!metadata) findings.push({ kind: "missing_blob", expected });
      else if (!matches(expected, metadata)) findings.push({ kind: "metadata_mismatch", expected, actual: metadata });
    });
    return {
      scanned: page.descriptors.length,
      findings,
      nextCheckpoint: page.nextCheckpoint
        ? { phase: "manifest", checkpoint: page.nextCheckpoint }
        : { phase: "inventory", prefix: MANAGED_PREFIXES[0] },
    };
  }

  private async scanInventoryPage(
    checkpoint: Extract<BlobReconciliationCheckpoint, { phase: "inventory" }>,
    limit: number,
    orphanBefore: string,
  ): Promise<BlobReconciliationPage> {
    const page = await this.inventory.listPrefix({
      prefix: checkpoint.prefix,
      ...(checkpoint.checkpoint ? { checkpoint: checkpoint.checkpoint } : {}),
      limit,
    });
    const expected = new Map(
      (await this.manifests.findByObjectKeys(page.objects.map(({ key }) => key)))
        .map((descriptor) => [descriptor.objectKey, descriptor]),
    );
    const findings: BlobReconciliationFinding[] = [];
    for (const actual of page.objects) {
      const descriptor = expected.get(actual.key);
      if (descriptor) {
        if (!matches(descriptor, actual)) findings.push({ kind: "metadata_mismatch", expected: descriptor, actual });
      } else if (actual.lastModified <= orphanBefore) {
        findings.push({ kind: "orphan_candidate", actual });
      }
    }
    const prefixIndex = MANAGED_PREFIXES.indexOf(checkpoint.prefix);
    return {
      scanned: page.objects.length,
      findings,
      nextCheckpoint: page.nextCheckpoint
        ? { ...checkpoint, checkpoint: page.nextCheckpoint }
        : prefixIndex + 1 < MANAGED_PREFIXES.length
          ? { phase: "inventory", prefix: MANAGED_PREFIXES[prefixIndex + 1]! }
          : null,
    };
  }
}

function matches(expected: BlobManifestDescriptor, actual: BlobMetadata): boolean {
  return actual.key === expected.objectKey
    && actual.size === expected.byteSize
    && actual.contentType === expected.contentType
    && actual.sha256 === expected.sha256;
}

async function mapLimited<T, U>(
  items: readonly T[],
  concurrency: number,
  map: (item: T) => Promise<U>,
): Promise<readonly U[]> {
  const results = new Array<U>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await map(items[index]!);
    }
  }));
  return results;
}
