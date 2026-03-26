import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { botTaskSchema, type BotTask } from "@guild/shared";
import type { BotRuntimeConfig } from "./config";
import { listDiscordGuildChannels, sendDiscordTask } from "./discord/adapter";
import { sendWechatTask } from "./wechat/adapter";
import { createWorkerClient } from "./worker-client";

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

function verifySignature(payload: string, signature: string, timestamp: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const normalizedSignature = signature.trim().toLowerCase();

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(normalizedSignature);
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

function isFreshTimestamp(timestampHeader: string): boolean {
  const timestamp = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return Math.abs(Date.now() - timestamp) <= MAX_TIMESTAMP_SKEW_MS;
}

function buildGetSignaturePayload(pathname: string, searchParams: URLSearchParams): string {
  const query = searchParams.toString();
  return `GET:${pathname}${query ? `?${query}` : ""}`;
}

export function startTaskReceiver(config: BotRuntimeConfig): void {
  const workerClient = createWorkerClient(config);

  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const isTaskDispatchRoute = req.method === "POST" && requestUrl.pathname === "/internal/bot/tasks";
    const isDiscordChannelsRoute =
      req.method === "GET" && requestUrl.pathname === "/internal/bot/discord/channels";

    if (!isTaskDispatchRoute && !isDiscordChannelsRoute) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    const signature = req.headers["x-signature"];
    const timestamp = req.headers["x-timestamp"];

    if (typeof signature !== "string" || typeof timestamp !== "string") {
      res.statusCode = 401;
      res.end("Missing signature headers");
      return;
    }

    if (!isFreshTimestamp(timestamp)) {
      res.statusCode = 401;
      res.end("Expired timestamp");
      return;
    }

    if (isDiscordChannelsRoute) {
      const signaturePayload = buildGetSignaturePayload(requestUrl.pathname, requestUrl.searchParams);
      if (!verifySignature(signaturePayload, signature, timestamp, config.workerSharedSecret)) {
        res.statusCode = 401;
        res.end("Invalid signature");
        return;
      }

      const guildId = requestUrl.searchParams.get("guild_id")?.trim();
      if (!guildId) {
        res.statusCode = 400;
        res.end("Missing guild_id");
        return;
      }

      void (async () => {
        try {
          const channels = await listDiscordGuildChannels(guildId);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ guild_id: guildId, channels }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: false,
              message: error instanceof Error ? error.message : "Failed to fetch Discord channels",
            }),
          );
        }
      })();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", async () => {
      const payload = Buffer.concat(chunks).toString("utf8");

      if (!verifySignature(payload, signature, timestamp, config.workerSharedSecret)) {
        res.statusCode = 401;
        res.end("Invalid signature");
        return;
      }

      let task: BotTask;
      try {
        task = botTaskSchema.parse(JSON.parse(payload));
      } catch {
        res.statusCode = 400;
        res.end("Invalid task payload");
        return;
      }

      try {
        const deliveryResult =
          task.platform === "discord" ? await sendDiscordTask(task) : await sendWechatTask(task);

        await workerClient.taskStatus(task.task_id, {
          status: "sent",
          ...(deliveryResult.messageId ? { message_id: deliveryResult.messageId } : {}),
        });

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, message_id: deliveryResult.messageId }));
      } catch (error) {
        await workerClient.taskStatus(task.task_id, {
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        });

        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false }));
      }
    });
  });

  server.listen(config.taskReceiverPort, () => {
    console.log(`[bot-runtime] task receiver listening on ${config.taskReceiverPort}`);
  });
}
