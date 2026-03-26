import type {
  Client,
  Message,
  MessageReaction,
  PartialMessage,
  PartialMessageReaction,
  PartialUser,
  User,
} from "discord.js";
import type { WorkerClient } from "../worker-client";

const SIGNUP_EMOJI = "✅";

type AnyReaction = MessageReaction | PartialMessageReaction;
type AnyUser = User | PartialUser;
type AnyMessage = Message | PartialMessage;

function extractEventIdFromMessage(message: AnyMessage): string | null {
  const content = typeof message.content === "string" ? message.content : "";
  const contentMatch = content.match(/event[:#\s-]*([a-zA-Z0-9_-]{6,})/i);
  if (contentMatch?.[1]) {
    return contentMatch[1];
  }

  for (const embed of message.embeds) {
    const footerText = embed.footer?.text;
    if (!footerText) {
      continue;
    }

    const footerMatch = footerText.match(/event[:#\s-]*([a-zA-Z0-9_-]{6,})/i);
    if (footerMatch?.[1]) {
      return footerMatch[1];
    }
  }

  return null;
}

async function ensureReactionMaterialized(reaction: AnyReaction): Promise<MessageReaction | null> {
  try {
    if (reaction.partial) {
      return await reaction.fetch();
    }
    return reaction;
  } catch {
    return null;
  }
}

async function ensureMessageMaterialized(message: AnyMessage): Promise<Message | null> {
  try {
    if (message.partial) {
      return await message.fetch();
    }
    return message;
  } catch {
    return null;
  }
}

async function handleJoinReaction(
  reaction: AnyReaction,
  user: AnyUser,
  workerClient: WorkerClient,
  action: "join" | "leave",
): Promise<void> {
  if (user.bot) {
    return;
  }

  const hydratedReaction = await ensureReactionMaterialized(reaction);
  if (!hydratedReaction) {
    return;
  }

  if (hydratedReaction.emoji.name !== SIGNUP_EMOJI) {
    return;
  }

  const hydratedMessage = await ensureMessageMaterialized(hydratedReaction.message);
  if (!hydratedMessage) {
    return;
  }

  const eventId = extractEventIdFromMessage(hydratedMessage);
  if (!eventId) {
    return;
  }

  if (action === "join") {
    await workerClient.signup({
      event_id: eventId,
      discord_id: user.id,
      source: "discord",
    });
    return;
  }

  await workerClient.leave({
    event_id: eventId,
    discord_id: user.id,
    source: "discord",
  });
}

export function attachReactionHandlers(client: Client, workerClient: WorkerClient): void {
  client.on("messageReactionAdd", async (reaction, user) => {
    try {
      await handleJoinReaction(reaction, user, workerClient, "join");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[discord] reaction add failed", message);
    }
  });

  client.on("messageReactionRemove", async (reaction, user) => {
    try {
      await handleJoinReaction(reaction, user, workerClient, "leave");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[discord] reaction remove failed", message);
    }
  });
}
