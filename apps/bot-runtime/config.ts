export type BotRuntimeConfig = {
  workerApiBaseUrl: string;
  workerSharedSecret: string;
  taskReceiverPort: number;
  discordToken?: string;
  discordClientId?: string;
  discordGuildId?: string;
  wechatyName: string;
  wechatPuppet?: string;
  wechatPuppetToken?: string;
  wechatServiceToken?: string;
  enableDiscord: boolean;
  enableWechat: boolean;
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function loadConfig(): BotRuntimeConfig {
  const workerApiBaseUrl = (process.env.WORKER_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
  const discordToken = process.env.DISCORD_BOT_TOKEN;
  const workerSharedSecret = process.env.BOT_SHARED_SECRET?.trim();
  if (!workerSharedSecret) {
    throw new Error("BOT_SHARED_SECRET is required");
  }

  return {
    workerApiBaseUrl,
    workerSharedSecret,
    taskReceiverPort: Number(process.env.BOT_RUNTIME_PORT ?? 3100),
    discordToken,
    discordClientId: process.env.DISCORD_CLIENT_ID,
    discordGuildId: process.env.DISCORD_GUILD_ID,
    wechatyName: process.env.WECHATY_NAME ?? "infini-guild-bot",
    wechatPuppet: process.env.WECHATY_PUPPET,
    wechatPuppetToken: process.env.WECHATY_PUPPET_TOKEN,
    wechatServiceToken: process.env.WECHATY_SERVICE_TOKEN,
    enableDiscord: parseBoolean(process.env.BOT_ENABLE_DISCORD, Boolean(discordToken)),
    enableWechat: parseBoolean(process.env.BOT_ENABLE_WECHAT, false),
  };
}
