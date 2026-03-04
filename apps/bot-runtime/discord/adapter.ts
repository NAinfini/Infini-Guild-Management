import type { BotTask } from "@guild/shared";
import {
  createBot,
  errorBoundaryMiddleware,
  loggerMiddleware,
  rateLimitMiddleware,
  type BotAdapter,
  type UnifiedBot,
} from "@infini-dev-kit/bot-core";
import {
  createDiscordAdapter,
  getDiscordClient,
  type DiscordClientLike,
} from "@infini-dev-kit/bot-discord";
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  Partials,
  type MessageCreateOptions,
} from "discord.js";
import type { BotRuntimeConfig } from "../config";
import { attachCommandHandlers, registerDiscordTextCommands, registerSlashCommands } from "./commands";
import { formatDiscordTaskMessage } from "./formatters";
import { attachReactionHandlers } from "./reactions";
import type { WorkerClient } from "../worker-client";

type DiscordRuntimeState = {
  bot: UnifiedBot | null;
  adapter: BotAdapter | null;
  client: Client | null;
  startPromise: Promise<void> | null;
};

const state: DiscordRuntimeState = {
  bot: null,
  adapter: null,
  client: null,
  startPromise: null,
};

type SentDiscordMessage = {
  id: string;
  react(emoji: string): Promise<unknown>;
};

export type DiscordGuildChannel = {
  id: string;
  name: string;
  type: string;
};

const SELECTABLE_CHANNEL_TYPES = new Set<number>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

export async function listDiscordGuildChannels(guildId: string): Promise<DiscordGuildChannel[]> {
  if (!state.client) {
    throw new Error("Discord adapter not connected");
  }

  const normalizedGuildId = guildId.trim();
  if (!normalizedGuildId) {
    throw new Error("Discord guild_id is required");
  }

  const guild = await state.client.guilds.fetch(normalizedGuildId);
  if (!guild) {
    return [];
  }

  const channels = await guild.channels.fetch();
  const mapped: DiscordGuildChannel[] = [];
  for (const channel of channels.values()) {
    if (!channel) {
      continue;
    }
    if (!channel.isTextBased() || !SELECTABLE_CHANNEL_TYPES.has(channel.type)) {
      continue;
    }

    const label = "name" in channel && typeof channel.name === "string"
      ? channel.name
      : channel.id;
    mapped.push({
      id: channel.id,
      name: label,
      type: ChannelType[channel.type] ?? String(channel.type),
    });
  }

  mapped.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  return mapped;
}

function resolveChannelId(task: BotTask): string | null {
  const channelIdFromTarget = task.target.channel_id;
  if (typeof channelIdFromTarget === "string" && channelIdFromTarget.length > 0) {
    return channelIdFromTarget;
  }

  const genericId = task.target.id;
  if (typeof genericId === "string" && genericId.length > 0) {
    return genericId;
  }

  return null;
}

function resolveReminderRecipientId(task: BotTask): string | null {
  const userId = task.target.user_id;
  if (typeof userId === "string" && userId.trim().length > 0) {
    return userId.trim();
  }

  if (typeof task.target.id === "string" && task.target.id.trim().length > 0) {
    return task.target.id.trim();
  }

  const payloadUserId = task.payload.discord_id;
  if (typeof payloadUserId === "string" && payloadUserId.trim().length > 0) {
    return payloadUserId.trim();
  }

  return null;
}

async function sendDiscordReminder(task: BotTask, payload: MessageCreateOptions): Promise<{ messageId: string | null }> {
  if (!state.client) {
    throw new Error("Discord adapter not connected");
  }

  const recipientId = resolveReminderRecipientId(task);
  if (!recipientId) {
    throw new Error(`Discord reminder missing recipient for task ${task.task_id}`);
  }

  const user = await state.client.users.fetch(recipientId);
  if (!user) {
    throw new Error(`Discord user not found for reminder: ${recipientId}`);
  }

  const content = typeof payload.content === "string" ? payload.content : "Reminder";
  const message = await user.send(content);
  return { messageId: message.id };
}

export async function startDiscordAdapter(config: BotRuntimeConfig, workerClient: WorkerClient): Promise<void> {
  if (!config.enableDiscord) {
    return;
  }

  const discordToken = config.discordToken;
  if (!discordToken) {
    console.warn("[discord] DISCORD_BOT_TOKEN is missing, adapter disabled");
    return;
  }

  if (state.adapter?.isRunning()) {
    return;
  }

  if (!state.startPromise) {
    state.startPromise = (async () => {
      const rawClient = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.GuildMessageReactions,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.MessageContent,
        ],
        partials: [Partials.Channel, Partials.Message, Partials.Reaction],
      });

      const adapter = createDiscordAdapter({
        token: discordToken,
        clientFactory: () => rawClient as unknown as DiscordClientLike,
      });
      const bot = createBot({
        adapter,
        middlewares: [
          errorBoundaryMiddleware(async (error, ctx) => {
            console.error(
              `[discord] middleware error sender=${ctx.message.sender.id} conversation=${ctx.message.conversation.id}`,
              error,
            );
          }),
          rateLimitMiddleware({
            maxPerMinute: 60,
            onLimit: async (ctx) => {
              await ctx.message.reply("Rate limit exceeded. Please retry in one minute.");
            },
          }),
          loggerMiddleware((message) => {
            console.log(`[discord][pipeline] ${message}`);
          }),
        ],
      });
      registerDiscordTextCommands(bot, workerClient);

      const client = getDiscordClient(adapter) as unknown as Client;

      client.once("ready", async () => {
        console.log(`[discord] connected as ${client.user?.tag ?? "unknown"}`);
        try {
          await registerSlashCommands(config);
          console.log("[discord] slash commands registered");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("[discord] slash command registration failed", message);
        }
      });

      client.on("error", (error) => {
        console.error("[discord] client error", error);
      });

      attachCommandHandlers(client, workerClient);
      attachReactionHandlers(client, workerClient);

      state.bot = bot;
      state.adapter = adapter;
      state.client = client;

      await bot.start();
    })()
      .catch((error) => {
        state.bot = null;
        state.adapter = null;
        state.client = null;
        throw error;
      })
      .finally(() => {
        state.startPromise = null;
      });
  }

  await state.startPromise;
}

export async function sendDiscordTask(task: BotTask): Promise<{ messageId: string | null }> {
  if (!state.client) {
    console.warn("[discord-task] skipped: adapter not connected", task.task_id);
    return { messageId: null };
  }

  const payload: MessageCreateOptions = formatDiscordTaskMessage(task);
  if (task.task_type === "reminder") {
    return sendDiscordReminder(task, payload);
  }

  const channelId = resolveChannelId(task);
  if (!channelId) {
    console.warn("[discord-task] skipped: missing channel target", task.task_id);
    return { messageId: null };
  }

  const channel = await state.client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Discord channel is not text-capable: ${channelId}`);
  }

  const sendable = channel as { send?: (options: MessageCreateOptions) => Promise<SentDiscordMessage> };
  if (typeof sendable.send !== "function") {
    throw new Error(`Discord channel cannot send messages: ${channelId}`);
  }

  const message = await sendable.send(payload);
  if (task.task_type === "event_notify" && typeof task.payload.event_id === "string") {
    await message.react("✅");
    await message.react("❌");
  }
  return { messageId: message.id };
}
