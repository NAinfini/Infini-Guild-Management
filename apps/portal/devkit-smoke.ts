import { composeMantineTheme } from "./theme/mantine-adapter";
import { createThemeProviderBridge } from "@infini-dev-kit/theme-core";
import { createApiClient } from "@infini-dev-kit/api-client";
import { createRequestId } from "@infini-dev-kit/utils";

export const portalDevKitSmoke = {
  composeMantineTheme,
  createThemeProviderBridge,
  createApiClient,
  createRequestId,
};
