import type { BotTask } from "@guild/shared";
import {
  createBot,
  errorBoundaryMiddleware,
  loggerMiddleware,
  rateLimitMiddleware,
  type BotContext,
  type BotAdapter,
  type UnifiedBot,
} from "@infini-dev-kit/bot-core";
import { createWechatAdapter, type WechatBotLike } from "@infini-dev-kit/bot-wechat";
import type { BotRuntimeConfig } from "../config";
import type { WorkerClient } from "../worker-client";
import { buildWechatMessage } from "./formatters";

type WechatContactLike = {
  id: string;
  name?: () => string;
  alias?: () => string | undefined;
};

type WechatRoomLike = {
  id: string;
  say(message: unknown): Promise<unknown>;
  ready?: (forceSync?: boolean) => Promise<void>;
};

type WechatRoomResolver = {
  load(id: string): WechatRoomLike;
  find(query: string | { id?: string; topic?: string }): Promise<WechatRoomLike | undefined>;
};

type WechatContactResolver = {
  find(query: string | { id?: string }): Promise<WechatContactLike | undefined>;
};

type WechatyLike = {
  Room: WechatRoomResolver;
  Contact?: WechatContactResolver;
  start(): Promise<void>;
  stop(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): WechatyLike;
};

type WechatyModule = {
  WechatyBuilder: {
    build(options: Record<string, unknown>): WechatyLike;
  };
};

type WechatRuntimeState = {
  config: BotRuntimeConfig | null;
  workerClient: WorkerClient | null;
  enabled: boolean;
  adapter: BotAdapter | null;
  bot: UnifiedBot | null;
  client: WechatBotLike | null;
  startPromise: Promise<void> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  readyAt: string | null;
  lastError: string | null;
};

const state: WechatRuntimeState = {
  config: null,
  workerClient: null,
  enabled: false,
  adapter: null,
  bot: null,
  client: null,
  startPromise: null,
  reconnectTimer: null,
  readyAt: null,
  lastError: null,
};

const RECONNECT_DELAY_MS = 10_000;

function formatIsoDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

async function replySafe(ctx: BotContext, content: string): Promise<void> {
  await ctx.message.reply(content);
}

function registerWechatTextCommands(bot: UnifiedBot, workerClient: WorkerClient): void {
  bot.command({
    name: "help",
    description: "Show available WeChat commands",
    handler: async (ctx) => {
      await replySafe(
        ctx,
        [
          "可用指令:",
          "/events - 查看近7天活动",
          "/teams - 查看当前帮战分队",
          "/roster - 查看活跃成员名单",
          "/stats <用户名> - 查看指定成员帮战数据",
        ].join("\n"),
      );
    },
  });

  bot.command({
    name: "events",
    description: "List upcoming events",
    handler: async (ctx) => {
      const response = await workerClient.events();
      if (response.data.length === 0) {
        await replySafe(ctx, "近7天没有活动。");
        return;
      }

      const lines = response.data.slice(0, 10).map((event, index) => {
        const cap = event.capacity === null ? "" : ` | cap ${event.capacity}`;
        return `${index + 1}. [${event.type}] ${event.title} | ${formatIsoDateTime(event.start_at)}${cap}`;
      });
      await replySafe(ctx, `近期活动:\n${lines.join("\n")}`);
    },
  });

  bot.command({
    name: "teams",
    description: "Show guild-war teams",
    handler: async (ctx) => {
      const response = await workerClient.teams();
      if (!response.war || response.teams.length === 0) {
        await replySafe(ctx, "当前没有进行中的帮战分队。");
        return;
      }

      const teamLines = response.teams.map((team) => {
        const members = team.members
          .map((member) => `@${member.wechat_name ?? member.username}${member.role_tag ? `(${member.role_tag})` : ""}`)
          .join("、");
        return `• ${team.team_name}: ${members || "暂无成员"}`;
      });

      await replySafe(
        ctx,
        `帮战: ${response.war.war_name} (${response.war.created_at.slice(0, 10)})\n${teamLines.join("\n")}`,
      );
    },
  });

  bot.command({
    name: "roster",
    description: "Show active roster",
    handler: async (ctx) => {
      const response = await workerClient.roster();
      if (response.data.length === 0) {
        await replySafe(ctx, "成员名单为空。");
        return;
      }

      const lines = response.data.slice(0, 20).map((member, index) => {
        return `${index + 1}. ${member.username} | ${member.class_name ?? "-"} | ${member.power}`;
      });
      await replySafe(ctx, `成员名单:\n${lines.join("\n")}`);
    },
  });

  bot.command({
    name: "stats",
    description: "Show guild-war stats for a member",
    handler: async (ctx, args) => {
      const member = args.join(" ").trim();
      if (!member) {
        await replySafe(ctx, "用法: /stats <用户名>");
        return;
      }

      const response = await workerClient.stats({ member });
      if (response.wars.length === 0) {
        await replySafe(ctx, `未找到 ${response.member.username} 的帮战记录。`);
        return;
      }

      const lines = response.wars.map((war, index) => {
        const kills = war.kills ?? 0;
        const deaths = war.deaths ?? 0;
        const assists = war.assists ?? 0;
        const damage = war.damage ?? 0;
        const healing = war.healing ?? 0;
        return `${index + 1}. ${war.war_name} (${formatIsoDateTime(war.created_at)}) | K/D/A ${kills}/${deaths}/${assists} | 伤害 ${damage} | 治疗 ${healing}`;
      });
      await replySafe(ctx, `${response.member.username} 的数据:\n${lines.join("\n")}`);
    },
  });
}

function buildWechatyOptions(config: BotRuntimeConfig): Record<string, unknown> {
  const options: Record<string, unknown> = {
    name: config.wechatyName,
  };

  if (config.wechatPuppet) {
    options.puppet = config.wechatPuppet;
  }

  const puppetOptions: Record<string, string> = {};
  if (config.wechatPuppetToken) {
    puppetOptions.token = config.wechatPuppetToken;
  }
  if (config.wechatServiceToken) {
    puppetOptions.serviceToken = config.wechatServiceToken;
  }
  if (Object.keys(puppetOptions).length > 0) {
    options.puppetOptions = puppetOptions;
  }

  return options;
}

function scheduleReconnect(reason: string): void {
  if (!state.enabled || !state.config || !state.workerClient) {
    return;
  }
  const workerClient = state.workerClient;

  if (state.reconnectTimer) {
    return;
  }

  console.warn(`[wechat] scheduling reconnect in ${RECONNECT_DELAY_MS}ms: ${reason}`);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    void ensureWechatStarted(workerClient).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      state.lastError = message;
      console.error("[wechat] reconnect failed", message);
      scheduleReconnect("reconnect failure");
    });
  }, RECONNECT_DELAY_MS);
}

async function importWechatyModule(): Promise<WechatyModule> {
  const imported = (await import("wechaty")) as unknown;
  if (typeof imported !== "object" || imported === null || !("WechatyBuilder" in imported)) {
    throw new Error("wechaty module missing WechatyBuilder export");
  }
  return imported as WechatyModule;
}

async function resolveRoom(bot: WechatyLike, target: string): Promise<WechatRoomLike | null> {
  try {
    const loaded = bot.Room.load(target);
    if (typeof loaded.ready === "function") {
      await loaded.ready();
    }
    return loaded;
  } catch {
    // Continue to fallback find flows.
  }

  const byId = await bot.Room.find({ id: target });
  if (byId) {
    return byId;
  }

  const byTopic = await bot.Room.find({ topic: target });
  if (byTopic) {
    return byTopic;
  }

  const byString = await bot.Room.find(target);
  return byString ?? null;
}

async function resolveContact(bot: WechatyLike, target: string): Promise<WechatContactLike | null> {
  if (!bot.Contact) {
    return null;
  }

  const byId = await bot.Contact.find({ id: target });
  if (byId) {
    return byId;
  }

  const byString = await bot.Contact.find(target);
  return byString ?? null;
}

async function createWechatClient(config: BotRuntimeConfig): Promise<WechatBotLike> {
  const wechatyModule = await importWechatyModule();
  const bot = wechatyModule.WechatyBuilder.build(buildWechatyOptions(config));

  bot.on("scan", (qrcode, status) => {
    const code = typeof qrcode === "string" ? qrcode.slice(0, 32) : "";
    console.log(`[wechat] scan status=${String(status)} qrcode=${code}`);
  });
  bot.on("login", (user) => {
    const maybeUser = user as WechatContactLike | undefined;
    const username = maybeUser?.name?.() ?? maybeUser?.id ?? "unknown";
    state.lastError = null;
    state.readyAt = new Date().toISOString();
    console.log(`[wechat] logged in as ${username}`);
  });
  bot.on("logout", (user) => {
    const maybeUser = user as WechatContactLike | undefined;
    const username = maybeUser?.name?.() ?? maybeUser?.id ?? "unknown";
    state.readyAt = null;
    console.warn(`[wechat] logged out: ${username}`);
    scheduleReconnect("logout");
  });
  bot.on("error", (error) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    state.lastError = normalized.message;
    console.error("[wechat] runtime error", normalized);
    scheduleReconnect(normalized.message);
  });

  return {
    start: () => bot.start(),
    stop: () => bot.stop(),
    on: (event, listener) => {
      bot.on(event, (...args: unknown[]) => {
        listener(...args);
      });
    },
    findRoom: async (id) => {
      return (await resolveRoom(bot, id)) ?? undefined;
    },
    findContact: async (id) => {
      return (await resolveContact(bot, id)) ?? undefined;
    },
  };
}

async function ensureWechatStarted(workerClient: WorkerClient): Promise<void> {
  if (!state.enabled || !state.config) {
    throw new Error("WeChat adapter is disabled");
  }
  const activeConfig = state.config;

  if (state.adapter?.isRunning()) {
    return;
  }

  if (!state.startPromise) {
    state.startPromise = (async () => {
      if (!state.client || !state.adapter || !state.bot) {
        const client = await createWechatClient(activeConfig);
        const adapter = createWechatAdapter({
          name: activeConfig.wechatyName,
          clientFactory: () => client,
        });
        const bot = createBot({
          adapter,
          middlewares: [
            errorBoundaryMiddleware(async (error, ctx) => {
              console.error(
                `[wechat] middleware error sender=${ctx.message.sender.id} conversation=${ctx.message.conversation.id}`,
                error,
              );
            }),
            rateLimitMiddleware({
              maxPerMinute: 60,
              onLimit: async (ctx) => {
                await ctx.message.reply("请求过快，请稍后再试。");
              },
            }),
            loggerMiddleware((message) => {
              console.log(`[wechat][pipeline] ${message}`);
            }),
          ],
        });
        registerWechatTextCommands(bot, workerClient);

        state.client = client;
        state.adapter = adapter;
        state.bot = bot;
      }

      await state.bot.start();
    })()
      .catch((error) => {
        state.lastError = error instanceof Error ? error.message : String(error);
        scheduleReconnect("startup failure");
        throw error;
      })
      .finally(() => {
        state.startPromise = null;
      });
  }

  await state.startPromise;
}

function resolveRoomTarget(task: BotTask): string | null {
  const roomId = task.target.room_id;
  if (typeof roomId === "string" && roomId.trim().length > 0) {
    return roomId.trim();
  }

  if (typeof task.target.id === "string" && task.target.id.trim().length > 0) {
    return task.target.id.trim();
  }

  return null;
}

export async function startWechatAdapter(config: BotRuntimeConfig, workerClient: WorkerClient): Promise<void> {
  state.config = config;
  state.workerClient = workerClient;
  state.enabled = config.enableWechat;

  if (!config.enableWechat) {
    return;
  }

  await ensureWechatStarted(workerClient);
}

export function getWechatHealth(): {
  enabled: boolean;
  connected: boolean;
  ready_at: string | null;
  last_error: string | null;
} {
  return {
    enabled: state.enabled,
    connected: Boolean(state.adapter?.isRunning()),
    ready_at: state.readyAt,
    last_error: state.lastError,
  };
}

export async function sendWechatTask(task: BotTask): Promise<{ messageId: string | null }> {
  const message = buildWechatMessage(task);
  if (!state.enabled) {
    throw new Error("WeChat adapter is disabled");
  }
  if (!state.workerClient) {
    throw new Error("WeChat worker client is not initialized");
  }

  await ensureWechatStarted(state.workerClient);
  if (!state.adapter) {
    throw new Error("WeChat adapter is not connected");
  }

  const roomTarget = resolveRoomTarget(task);
  if (!roomTarget) {
    throw new Error("Missing WeChat room target id");
  }

  const sentMessage = await state.adapter.sendMessage(roomTarget, message);
  return {
    messageId: sentMessage.id ?? `wechat:${roomTarget}:${Date.now()}`,
  };
}
