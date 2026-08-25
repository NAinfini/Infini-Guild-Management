import type {
  BlobInventory,
  BlobStore,
  DeferredTasks,
  NotificationPublisher,
  RateLimiter,
  SqlExecutor,
} from "@guild/kernel";
import type { AdminOperationsRuntimePort, RuntimeHealthPort, TransactionalEmailSender } from "@guild/server";
import type { OAuthRuntimeConfig } from "./oauth-providers.js";
import { createPortalApiApp, type PortalApiConfig } from "./portal-api.js";
import { createApplicationServices } from "./services.js";

export type ApplicationDependencies = Readonly<{
  sql: SqlExecutor;
  blobs: BlobStore;
  blobInventory: BlobInventory;
  notifications: NotificationPublisher;
  deferred: DeferredTasks;
  health: RuntimeHealthPort;
  adminOperationsRuntime: AdminOperationsRuntimePort;
  authRateLimiter: RateLimiter;
  authIpRateLimiter: RateLimiter;
  emailSender?: TransactionalEmailSender | null;
  readRateLimiter: RateLimiter;
  expensiveReadRateLimiter: RateLimiter;
  mutationRateLimiter: RateLimiter;
  uploadRateLimiter: RateLimiter;
  clientIdentifier(request: Request): string;
  onUnexpectedError?(error: Error, requestId: string): void;
}>;

export type ApplicationConfig = PortalApiConfig & Readonly<{
  inviteTokenSecret: string;
  passwordIterations: number;
  oauth: OAuthRuntimeConfig;
  emailFrom: string | null;
}>;

export function createApplication(dependencies: ApplicationDependencies, config: ApplicationConfig) {
  const services = createApplicationServices({
    ...dependencies,
    authRateLimiter: dependencies.authRateLimiter,
    authIpRateLimiter: dependencies.authIpRateLimiter,
  }, {
    inviteTokenSecret: config.inviteTokenSecret,
    passwordIterations: config.passwordIterations,
    oauth: config.oauth,
    publicUrl: config.publicUrl,
    emailFrom: config.emailFrom,
  });
  const api = createPortalApiApp(services, {
    authRateLimiter: dependencies.authRateLimiter,
    readRateLimiter: dependencies.readRateLimiter,
    expensiveReadRateLimiter: dependencies.expensiveReadRateLimiter,
    mutationRateLimiter: dependencies.mutationRateLimiter,
    uploadRateLimiter: dependencies.uploadRateLimiter,
    deferred: dependencies.deferred,
    clientIdentifier: dependencies.clientIdentifier,
    ...(dependencies.onUnexpectedError ? { onUnexpectedError: dependencies.onUnexpectedError } : {}),
  }, config);
  return Object.freeze({ api, services });
}
