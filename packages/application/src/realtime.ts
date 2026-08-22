import type { AuthorizationContext, RateLimiter, SqlExecutor } from "@guild/kernel";
import { appSchema, createAppDatabase, SqliteAuthStore } from "@guild/persistence-sqlite";
import {
  AuthStoreNotificationSessionResolver,
  NotificationConnectionPolicy,
} from "@guild/server";
import { LIMITS } from "@guild/shared/config/limits";
import {
  readSessionCookie,
  resolveSessionCookieName,
  type PortalApiConfig,
} from "./portal-api.js";

/*
 * 通知连接策略的唯一装配配方。Cloudflare 的 Durable Object 是独立的隔离区
 * 入口，拿不到主 worker 的组合根；VPS 的 hub 必须先于应用组合创建（应用把
 * hub 当通知发布端口）。两个运行时都只能按各自的执行器重建策略，所以配方
 * 收敛在这里，不在运行时里各自手搓 store 和 resolver。
 */
export function createNotificationConnectionPolicy(sql: SqlExecutor): NotificationConnectionPolicy {
  const store = new SqliteAuthStore(createAppDatabase(sql, { schema: appSchema }), sql);
  return new NotificationConnectionPolicy(new AuthStoreNotificationSessionResolver(store));
}

export type WebSocketHandshakeRejection = Readonly<{
  status: 401 | 403 | 429;
  reason: string;
  retryAfterSeconds?: number;
}>;

export type WebSocketHandshakeAdmission =
  | Readonly<{ accepted: true; authorization: AuthorizationContext }>
  | (Readonly<{ accepted: false }> & WebSocketHandshakeRejection);

export type WebSocketHandshakeGateInput = Readonly<{
  request: Request;
  clientKey: string;
  rateLimiter: RateLimiter;
  auth: Readonly<{
    resolveAuthorization(
      token: string | null,
      nowIso: string,
    ): Promise<Readonly<{ authorization: AuthorizationContext }>>;
  }>;
  config: Pick<PortalApiConfig, "publicUrl" | "allowedOrigins" | "sessionCookieName">;
  nowIso: string;
}>;

/*
 * WebSocket 升级前的共享闸门：来源 → 频控 → 会话，检查顺序和拒绝语义在两个
 * 运行时必须一致。Upgrade 头检查（426）和平台握手留在各运行时——那是 HTTP
 * 层与平台 API 的事。
 */
export async function admitWebSocketHandshake(
  input: WebSocketHandshakeGateInput,
): Promise<WebSocketHandshakeAdmission> {
  const origin = input.request.headers.get("Origin");
  const allowed = new Set([input.config.publicUrl, ...(input.config.allowedOrigins ?? [])]);
  if (!origin || !allowed.has(origin)) {
    return { accepted: false, status: 403, reason: "Forbidden WebSocket origin" };
  }

  const rate = await input.rateLimiter.consume(`ws:${input.clientKey}`);
  if (!rate.allowed) {
    return {
      accepted: false,
      status: 429,
      reason: "Too many WebSocket handshakes",
      retryAfterSeconds: rate.retryAfterSeconds ?? LIMITS.websocket.handshakes.windowMs / 1_000,
    };
  }

  const token = readSessionCookie(
    input.request,
    resolveSessionCookieName(input.config.sessionCookieName),
  );
  const { authorization } = await input.auth.resolveAuthorization(token, input.nowIso);
  if (!authorization.isAuthenticated()) {
    return { accepted: false, status: 401, reason: "Authentication required" };
  }
  return { accepted: true, authorization };
}
