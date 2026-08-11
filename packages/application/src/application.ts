import type {
  BlobInventory,
  BlobStore,
  DeferredTasks,
  NotificationPublisher,
  RateLimiter,
  SqlExecutor,
} from "@guild/kernel";
import type { RuntimeHealthPort } from "@guild/server";
import { createPortalApiApp, type PortalApiConfig } from "./portal-api.js";
import { createApplicationServices } from "./services.js";

export type ApplicationDependencies = Readonly<{
  sql: SqlExecutor;
  blobs: BlobStore;
  blobInventory: BlobInventory;
  notifications: NotificationPublisher;
  deferred: DeferredTasks;
  health: RuntimeHealthPort;
  authRateLimiter: RateLimiter;
  readRateLimiter: RateLimiter;
  mutationRateLimiter: RateLimiter;
  uploadRateLimiter: RateLimiter;
  clientIdentifier(request: Request): string;
  onUnexpectedError?(error: Error, requestId: string): void;
}>;

export type ApplicationConfig = PortalApiConfig & Readonly<{
  inviteTokenSecret: string;
  passwordIterations: number;
}>;

export function createApplication(dependencies: ApplicationDependencies, config: ApplicationConfig) {
  const services = createApplicationServices({
    ...dependencies,
    authRateLimiter: dependencies.authRateLimiter,
  }, {
    inviteTokenSecret: config.inviteTokenSecret,
    passwordIterations: config.passwordIterations,
  });
  const api = createPortalApiApp(services, {
    authRateLimiter: dependencies.authRateLimiter,
    readRateLimiter: dependencies.readRateLimiter,
    mutationRateLimiter: dependencies.mutationRateLimiter,
    uploadRateLimiter: dependencies.uploadRateLimiter,
    deferred: dependencies.deferred,
    clientIdentifier: dependencies.clientIdentifier,
    ...(dependencies.onUnexpectedError ? { onUnexpectedError: dependencies.onUnexpectedError } : {}),
  }, config);
  return Object.freeze({ api, services });
}
