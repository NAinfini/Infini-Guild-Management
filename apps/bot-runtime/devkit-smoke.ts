import { createBot } from "@infini-dev-kit/bot-core";
import { createDiscordAdapter } from "@infini-dev-kit/bot-discord";
import { createWechatAdapter } from "@infini-dev-kit/bot-wechat";
import { createRequestId } from "@infini-dev-kit/utils/id";

export const botRuntimeDevKitSmoke = {
  createBot,
  createDiscordAdapter,
  createWechatAdapter,
  createRequestId,
};
