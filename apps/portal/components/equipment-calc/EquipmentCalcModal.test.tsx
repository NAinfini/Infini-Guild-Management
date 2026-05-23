// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gameDataSchema } from "@guild/shared/schemas/equipment-calc";
import seedGameData from "@guild/shared/calculator/seed-data.json";
import { EquipmentCalcModal } from "./EquipmentCalcModal";

let queryState: {
  data?: {
    data: ReturnType<typeof gameDataSchema.parse>;
    schemaVersion: number;
  };
  isLoading: boolean;
  isError: boolean;
} = {
  isLoading: false,
  isError: true,
};

const storeState = {
  migrateSchema: vi.fn(),
  schemaVersion: 1,
  exportData: vi.fn(() => "{}"),
  importData: vi.fn(),
  pool: [],
  loadouts: [],
  activeLoadoutId: null,
  unequipSlot: vi.fn(),
  addLoadout: vi.fn(),
  updateLoadout: vi.fn(),
  removeLoadout: vi.fn(),
  setActiveLoadout: vi.fn(),
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: "en" },
  }),
}));

vi.mock("@portal/api/queries/game-data", () => ({
  fetchGameData: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: () => queryState,
  };
});

vi.mock("@portal/stores/equipmentCalcStore", () => {
  return {
    useEquipmentCalcStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
    useActiveLoadout: () => storeState.loadouts.find((l: { id: string }) => l.id === storeState.activeLoadoutId) ?? null,
  };
});

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider>
        <EquipmentCalcModal opened onClose={vi.fn()} />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe("EquipmentCalcModal", () => {
  beforeEach(() => {
    storeState.migrateSchema.mockClear();
    storeState.exportData.mockClear();
    storeState.importData.mockClear();
    storeState.unequipSlot.mockClear();
    storeState.addLoadout.mockClear();
    storeState.updateLoadout.mockClear();
    storeState.removeLoadout.mockClear();
    storeState.setActiveLoadout.mockClear();
    storeState.pool = [];
    storeState.loadouts = [];
    storeState.activeLoadoutId = null;
  });

  it("shows localized load failure copy instead of raw server validation text", () => {
    queryState = { isLoading: false, isError: true };
    renderModal();

    expect(screen.getByText("Unable to load calculator data")).toBeInTheDocument();
    expect(screen.getByText("The stored calculator data is out of date. The server will use the bundled reference data.")).toBeInTheDocument();
    expect(screen.queryByText("Stored game data failed validation")).not.toBeInTheDocument();
  });

  it("renders the redesigned workspace shell", () => {
    queryState = {
      isLoading: false,
      isError: false,
      data: {
        data: gameDataSchema.parse(seedGameData),
        schemaVersion: 1,
      },
    };
    renderModal();

    expect(screen.getByText("stats.graduationRate")).toBeInTheDocument();
    expect(screen.getByText("stats.excelRate")).toBeInTheDocument();
    expect(screen.getByText("stats.expectedDps")).toBeInTheDocument();
    expect(screen.getByText("stats.breakdown")).toBeInTheDocument();
  });

  it("creates new loadouts with reference calculator defaults", async () => {
    const gameData = gameDataSchema.parse(seedGameData);
    queryState = {
      isLoading: false,
      isError: false,
      data: {
        data: gameData,
        schemaVersion: 1,
      },
    };
    renderModal();

    await userEvent.click(screen.getByLabelText("panels.config"));
    await userEvent.click(await screen.findByTitle("loadout.add"));

    const defaultClass = gameData.classes[0];
    expect(storeState.addLoadout).toHaveBeenCalledWith("loadout.defaultName", defaultClass, {
      armoryType: defaultClass.substring(0, 2),
      setId: gameData.defaultSets[defaultClass],
      xinfaSlots: gameData.xinfaRules[defaultClass].default,
    });
  });

  it("creates a reference-default loadout on open when none exists", () => {
    const gameData = gameDataSchema.parse(seedGameData);
    queryState = {
      isLoading: false,
      isError: false,
      data: {
        data: gameData,
        schemaVersion: 1,
      },
    };
    renderModal();

    const defaultClass = gameData.classes[0];
    expect(storeState.addLoadout).toHaveBeenCalledWith("loadout.defaultName", defaultClass, {
      armoryType: defaultClass.substring(0, 2),
      setId: gameData.defaultSets[defaultClass],
      xinfaSlots: gameData.xinfaRules[defaultClass].default,
    });
  });
});
