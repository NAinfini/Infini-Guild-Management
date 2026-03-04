import { composeMantineTheme } from "@infini-dev-kit/frontend/theme/mantine/mantine-adapter";
import { KitApp } from "@infini-dev-kit/frontend/provider";
import { createApiClient } from "@infini-dev-kit/api-client";
import { createRequestId } from "@infini-dev-kit/utils";

export const portalDevKitSmoke = {
  composeMantineTheme,
  KitApp,
  createApiClient,
  createRequestId,
};
