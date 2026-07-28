import seedGameData from "@guild/shared/calculator/seed-data.json";
import { describe, expect, it, vi } from "vitest";
import { GameDataService } from "../GameDataService";

function createServiceWithRows(rows: Array<{ data: string; version: string; createdAt: string }>) {
  const offset = vi.fn().mockResolvedValue(rows.slice(1));
  const limit = vi.fn().mockResolvedValue(rows.slice(0, 1));
  limit.mockImplementation(() => {
    const result = Promise.resolve(rows.slice(0, 1));
    (result as unknown as { offset: typeof offset }).offset = offset;
    return result;
  });
  const orderBy = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ orderBy }));
  const select = vi.fn(() => ({ from }));

  return new GameDataService({ select } as never, {
    writeAuditLog: vi.fn(),
  });
}

function withInvalidRotations() {
  return {
    ...seedGameData,
    rotations: Object.fromEntries(
      Object.entries(seedGameData.rotations).map(([classId, config]) => [
        classId,
        { ...config, rotation: [], skillDatabase: {} },
      ]),
    ),
  };
}

function withMissingMainStat(slotId: keyof typeof seedGameData.slotRules.mainStats) {
  return {
    ...seedGameData,
    slotRules: {
      ...seedGameData.slotRules,
      mainStats: {
        ...seedGameData.slotRules.mainStats,
        [slotId]: [...seedGameData.slotRules.mainStats[slotId], "__missing_stat__"],
      },
    },
  };
}

describe("GameDataService getLatest missing data", () => {
  it("returns null when no game data has been uploaded", async () => {
    const service = createServiceWithRows([]);

    const result = await service.getLatest();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeNull();
    }
  });
});

describe("GameDataService getLatest invalid data", () => {
  it("returns SERVER_ERROR when the latest stored game data is invalid", async () => {
    const service = createServiceWithRows([
      {
        data: JSON.stringify(withInvalidRotations()),
        version: "stale-invalid",
        createdAt: "2026-05-20T00:00:00.000Z",
      },
    ]);

    const result = await service.getLatest();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SERVER_ERROR");
      expect(result.message).toBe("Stored game data failed validation");
    }
  });

  it("returns SERVER_ERROR when stored game data is schema-valid but semantically invalid", async () => {
    const slotId = Object.keys(seedGameData.slotRules.mainStats)[0] as keyof typeof seedGameData.slotRules.mainStats;
    const service = createServiceWithRows([
      {
        data: JSON.stringify(withMissingMainStat(slotId)),
        version: "semantic-invalid",
        createdAt: "2026-05-20T00:00:00.000Z",
      },
    ]);

    const result = await service.getLatest();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SERVER_ERROR");
      expect(result.message).toBe("Stored game data failed semantic validation");
      expect(result.details).toEqual({
        validation_error: `slotRules.mainStats["${slotId}"] references stat "__missing_stat__" not found in maxValues`,
      });
    }
  });
});

describe("GameDataService getLatest regression cases", () => {
  it("returns SERVER_ERROR when the newest row is invalid even if an older row is valid", async () => {
    const service = createServiceWithRows([
      {
        data: JSON.stringify(withInvalidRotations()),
        version: "newest-invalid",
        createdAt: "2026-05-21T00:00:00.000Z",
      },
      {
        data: JSON.stringify(seedGameData),
        version: seedGameData.version,
        createdAt: "2026-05-20T00:00:00.000Z",
      },
    ]);

    const result = await service.getLatest();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SERVER_ERROR");
      expect(result.message).toBe("Stored game data failed validation");
    }
  });

  it("does not hide an empty database behind a prior successful read", async () => {
    const serviceWithData = createServiceWithRows([
      {
        data: JSON.stringify(seedGameData),
        version: seedGameData.version,
        createdAt: "2026-05-20T00:00:00.000Z",
      },
    ]);
    const serviceWithoutData = createServiceWithRows([]);

    const firstResult = await serviceWithData.getLatest();
    expect(firstResult.ok).toBe(true);

    const secondResult = await serviceWithoutData.getLatest();

    expect(secondResult.ok).toBe(true);
    if (secondResult.ok) {
      expect(secondResult.data).toBeNull();
    }
  });
});

describe("GameDataService response split", () => {
  const seeded = () => createServiceWithRows([
    { data: JSON.stringify(seedGameData), version: seedGameData.version, createdAt: "2026-05-20T00:00:00.000Z" },
  ]);

  it("omits rotations from getLatest but keeps them in getFull", async () => {
    const latest = await seeded().getLatest();
    const full = await seeded().getFull();

    expect(latest.ok && full.ok).toBe(true);
    if (!latest.ok || !full.ok || latest.data === null || full.data === null) return;
    expect("rotations" in latest.data.data).toBe(false);
    expect(Object.keys(full.data.data.rotations).length).toBeGreaterThan(0);
    // The whole point of the split: the trimmed payload is a fraction of the size.
    expect(JSON.stringify(latest.data.data).length * 4).toBeLessThan(JSON.stringify(full.data.data).length);
  });

  it("serves one class's rotation from getRotation", async () => {
    const classId = Object.keys(seedGameData.rotations)[0]!;

    const result = await seeded().getRotation(classId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.class_id).toBe(classId);
    expect(result.data.rotation.rotation.length).toBeGreaterThan(0);
  });

  it("fails loudly for an unknown class instead of returning nothing", async () => {
    const result = await seeded().getRotation("__no_such_class__");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NOT_FOUND");
  });

  it("fails loudly when no game data has been uploaded at all", async () => {
    const result = await createServiceWithRows([]).getRotation("anything");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NOT_FOUND");
    expect(result.message).toBe("No game data has been uploaded");
  });
});

describe("GameDataService upload", () => {
  function createUploadService() {
    const returning = vi.fn().mockResolvedValue([{ id: 1 }]);
    const values = vi.fn((_row: { data: string }) => ({ returning }));
    const insert = vi.fn(() => ({ values }));
    const limit = vi.fn().mockResolvedValue([]);
    const orderBy = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ orderBy }));
    const select = vi.fn(() => ({ from }));
    const deleteFn = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const service = new GameDataService({ insert, select, delete: deleteFn } as never, {
      writeAuditLog: vi.fn(),
    });
    return { service, values };
  }

  it("accepts bundled seed uploads with reference-skipped rotation rows", async () => {
    const { service } = createUploadService();

    const result = await service.upload(JSON.stringify(seedGameData), "admin-1");

    expect(result.ok).toBe(true);
  });

  it("stores the document minified but otherwise unchanged", async () => {
    const { service, values } = createUploadService();
    const prettyPrinted = JSON.stringify(seedGameData, null, 2);

    const result = await service.upload(prettyPrinted, "admin-1");

    expect(result.ok).toBe(true);
    const stored = values.mock.calls[0]![0].data;
    expect(stored.length).toBeLessThan(prettyPrinted.length);
    // Lossless: re-parsing the stored string must equal the uploaded document,
    // including keys the schema does not know about and defaults it would fill in.
    expect(JSON.parse(stored)).toEqual(JSON.parse(prettyPrinted));
  });

  it("keeps keys the schema does not declare", async () => {
    const { service, values } = createUploadService();
    const withExtra = { ...seedGameData, __vendorNote: "keep me" };

    const result = await service.upload(JSON.stringify(withExtra), "admin-1");

    expect(result.ok).toBe(true);
    const stored = values.mock.calls[0]![0].data;
    expect(JSON.parse(stored).__vendorNote).toBe("keep me");
  });
});

describe("GameDataService rollback", () => {
  it("rejects semantic-invalid stored data without inserting or writing audit", async () => {
    const slotId = Object.keys(seedGameData.slotRules.mainStats)[0] as keyof typeof seedGameData.slotRules.mainStats;
    const limit = vi.fn().mockResolvedValue([
      {
        id: 7,
        data: JSON.stringify(withMissingMainStat(slotId)),
        version: "semantic-invalid",
      },
    ]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const insert = vi.fn();
    const writeAuditLog = vi.fn();
    const service = new GameDataService({ select, insert } as never, {
      writeAuditLog,
    });

    const result = await service.rollback(7, "admin-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SERVER_ERROR");
      expect(result.message).toBe("Stored game data failed semantic validation");
    }
    expect(insert).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});
