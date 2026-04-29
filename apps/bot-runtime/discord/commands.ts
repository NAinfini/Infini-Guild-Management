import type { Client, ChatInputCommandInteraction, Message } from "discord.js";
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import type { BotRuntimeConfig } from "../config";
import type { WorkerClient } from "../worker-client";

export const slashCommands = [
  "events",
  "signup",
  "leave",
  "teams",
  "roster",
  "stats",
  "link",
  "verify",
  "reminders",
] as const;

export type SlashCommand = (typeof slashCommands)[number];

function formatIsoDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function buildSlashCommandPayload() {
  return [
    new SlashCommandBuilder()
      .setName("signup")
      .setDescription("Sign up for an event")
      .addStringOption((option) => option.setName("event_id").setDescription("Event ID").setRequired(true)),
    new SlashCommandBuilder()
      .setName("leave")
      .setDescription("Leave an event")
      .addStringOption((option) => option.setName("event_id").setDescription("Event ID").setRequired(true)),
    new SlashCommandBuilder()
      .setName("link")
      .setDescription("Start Discord account link")
      .addStringOption((option) => option.setName("username").setDescription("Portal username").setRequired(true)),
    new SlashCommandBuilder()
      .setName("verify")
      .setDescription("Verify Discord link code")
      .addStringOption((option) => option.setName("code").setDescription("6-digit code").setRequired(true)),
    new SlashCommandBuilder().setName("events").setDescription("List upcoming events in the next 7 days"),
    new SlashCommandBuilder().setName("teams").setDescription("Show current guild-war team assignments"),
    new SlashCommandBuilder().setName("roster").setDescription("Show active roster (username / class / power)"),
    new SlashCommandBuilder()
      .setName("stats")
      .setDescription("Show guild-war stats for a member")
      .addStringOption((option) =>
        option.setName("member").setDescription("Username (optional, defaults to your linked account)"),
      ),
    new SlashCommandBuilder()
      .setName("reminders")
      .setDescription("Toggle your Discord event reminder DM")
      .addStringOption((option) =>
        option
          .setName("mode")
          .setDescription("Reminder mode")
          .setRequired(true)
          .addChoices(
            { name: "on", value: "on" },
            { name: "off", value: "off" },
          ),
      ),
  ].map((command) => command.toJSON());
}

async function safeReply(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ content });
    return;
  }

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content, ephemeral: true });
    return;
  }

  await interaction.reply({ content, ephemeral: true });
}

function parseReminderMode(mode: string | null | undefined): "on" | "off" | null {
  if (!mode) {
    return null;
  }
  const normalized = mode.trim().toLowerCase();
  if (normalized === "on" || normalized === "off") {
    return normalized;
  }
  return null;
}

async function executeSignup(workerClient: WorkerClient, discordId: string, eventId: string): Promise<string> {
  await workerClient.signup({ event_id: eventId, discord_id: discordId, source: "discord" });
  return `Signed up for event ${eventId}.`;
}

async function executeLeave(workerClient: WorkerClient, discordId: string, eventId: string): Promise<string> {
  await workerClient.leave({ event_id: eventId, discord_id: discordId, source: "discord" });
  return `Left event ${eventId}.`;
}

async function executeEvents(workerClient: WorkerClient): Promise<string> {
  const response = await workerClient.events();
  if (response.data.length === 0) {
    return "No upcoming events in the next 7 days.";
  }

  const lines = response.data.slice(0, 10).map((event, index) => {
    const cap = event.capacity === null ? "" : ` | cap ${event.capacity}`;
    return `${index + 1}. [${event.type}] ${event.title} | ${formatIsoDateTime(event.start_at)}${cap}`;
  });
  return `Upcoming events:\n${lines.join("\n")}`;
}

async function executeTeams(workerClient: WorkerClient): Promise<string> {
  const response = await workerClient.teams();
  if (!response.war || response.teams.length === 0) {
    return "No active guild-war teams found.";
  }

  const teamLines = response.teams.map((team) => {
    const members = team.members
      .map((member) => `@${member.wechat_name ?? member.username}${member.role_tag ? `(${member.role_tag})` : ""}`)
      .join(", ");
    return `• ${team.team_name}: ${members || "no members"}`;
  });

  return `Guild war: ${response.war.war_name} (${response.war.created_at.slice(0, 10)})\n${teamLines.join("\n")}`;
}

async function executeRoster(workerClient: WorkerClient): Promise<string> {
  const response = await workerClient.roster();
  if (response.data.length === 0) {
    return "Roster is empty.";
  }

  const lines = response.data.slice(0, 20).map((member, index) => {
    return `${index + 1}. ${member.username} | ${member.class_name ?? "-"} | ${member.power}`;
  });
  return `Roster:\n${lines.join("\n")}`;
}

async function executeStats(workerClient: WorkerClient, discordId: string, member?: string): Promise<string> {
  const response = await workerClient.stats({ member, discord_id: discordId });
  if (response.wars.length === 0) {
    return `No guild-war records found for ${response.member.username}.`;
  }

  const lines = response.wars.map((war, index) => {
    const kills = war.kills ?? 0;
    const deaths = war.deaths ?? 0;
    const assists = war.assists ?? 0;
    const damage = war.damage ?? 0;
    const healing = war.healing ?? 0;
    return `${index + 1}. ${war.war_name} (${formatIsoDateTime(war.created_at)}) | K/D/A ${kills}/${deaths}/${assists} | Dmg ${damage} | Heal ${healing}`;
  });
  return `Stats for ${response.member.username}:\n${lines.join("\n")}`;
}

async function executeLinkStart(workerClient: WorkerClient, discordId: string, username: string): Promise<string> {
  const response = await workerClient.linkStart({ username, discord_id: discordId });
  return response.code;
}

async function executeVerify(workerClient: WorkerClient, discordId: string, code: string): Promise<string> {
  await workerClient.linkVerify({ code, discord_id: discordId });
  return "Discord account linked successfully.";
}

async function executeReminders(
  workerClient: WorkerClient,
  discordId: string,
  mode: "on" | "off",
): Promise<string> {
  await workerClient.reminders({ mode, discord_id: discordId });
  return `Discord reminders turned ${mode}.`;
}

const COMMAND_PREFIX = "/";

export function handleTextCommand(message: Message, workerClient: WorkerClient): void {
  const text = message.content.trim();
  if (!text.startsWith(COMMAND_PREFIX)) {
    return;
  }

  const withoutPrefix = text.slice(COMMAND_PREFIX.length).trim();
  if (withoutPrefix.length === 0) {
    return;
  }

  const [commandName, ...args] = withoutPrefix.split(/\s+/);
  const normalized = commandName.toLowerCase();
  const senderId = message.author.id;

  const reply = async (content: string): Promise<void> => {
    await message.reply(content);
  };

  const run = async (): Promise<void> => {
    switch (normalized) {
      case "help":
        await reply(
          [
            "Available text commands:",
            "/events",
            "/signup <event_id>",
            "/leave <event_id>",
            "/teams",
            "/roster",
            "/stats [member]",
            "/link <username>",
            "/verify <code>",
            "/reminders <on|off>",
          ].join("\n"),
        );
        return;
      case "events":
        await reply(await executeEvents(workerClient));
        return;
      case "signup": {
        const eventId = args[0]?.trim();
        if (!eventId) {
          await reply("Usage: /signup <event_id>");
          return;
        }
        await reply(await executeSignup(workerClient, senderId, eventId));
        return;
      }
      case "leave": {
        const eventId = args[0]?.trim();
        if (!eventId) {
          await reply("Usage: /leave <event_id>");
          return;
        }
        await reply(await executeLeave(workerClient, senderId, eventId));
        return;
      }
      case "teams":
        await reply(await executeTeams(workerClient));
        return;
      case "roster":
        await reply(await executeRoster(workerClient));
        return;
      case "stats": {
        const member = args.join(" ").trim() || undefined;
        await reply(await executeStats(workerClient, senderId, member));
        return;
      }
      case "link": {
        const username = args.join(" ").trim();
        if (!username) {
          await reply("Usage: /link <username>");
          return;
        }
        const code = await executeLinkStart(workerClient, senderId, username);
        await reply(`Link code: ${code} (valid for 5 minutes). Keep this private.`);
        return;
      }
      case "verify": {
        const code = args[0]?.trim();
        if (!code) {
          await reply("Usage: /verify <code>");
          return;
        }
        await reply(await executeVerify(workerClient, senderId, code));
        return;
      }
      case "reminders": {
        const mode = parseReminderMode(args[0]);
        if (!mode) {
          await reply("Usage: /reminders <on|off>");
          return;
        }
        await reply(await executeReminders(workerClient, senderId, mode));
        return;
      }
      default:
        return;
    }
  };

  void run().catch((error) => {
    console.error(
      `[bot-discord] text command error sender=${senderId} command=${normalized}`,
      error,
    );
  });
}

async function handleSignup(interaction: ChatInputCommandInteraction, workerClient: WorkerClient): Promise<void> {
  const eventId = interaction.options.getString("event_id", true);
  await safeReply(interaction, await executeSignup(workerClient, interaction.user.id, eventId));
}

async function handleLeave(interaction: ChatInputCommandInteraction, workerClient: WorkerClient): Promise<void> {
  const eventId = interaction.options.getString("event_id", true);
  await safeReply(interaction, await executeLeave(workerClient, interaction.user.id, eventId));
}

async function handleLink(interaction: ChatInputCommandInteraction, workerClient: WorkerClient): Promise<void> {
  const username = interaction.options.getString("username", true);
  const code = await executeLinkStart(workerClient, interaction.user.id, username);
  const dmMessage = `Your link code is: ${code} (valid for 5 minutes).`;

  try {
    await interaction.user.send(dmMessage);
    await safeReply(interaction, "Link code sent to your DM. Use /verify with the 6-digit code.");
  } catch {
    await safeReply(
      interaction,
      `Unable to DM you. Link code: ${code} (valid for 5 minutes). Keep this message private.`,
    );
  }
}

async function handleVerify(interaction: ChatInputCommandInteraction, workerClient: WorkerClient): Promise<void> {
  const code = interaction.options.getString("code", true);
  await safeReply(interaction, await executeVerify(workerClient, interaction.user.id, code));
}

async function handleEvents(interaction: ChatInputCommandInteraction, workerClient: WorkerClient): Promise<void> {
  await safeReply(interaction, await executeEvents(workerClient));
}

async function handleTeams(interaction: ChatInputCommandInteraction, workerClient: WorkerClient): Promise<void> {
  await safeReply(interaction, await executeTeams(workerClient));
}

async function handleRoster(interaction: ChatInputCommandInteraction, workerClient: WorkerClient): Promise<void> {
  await safeReply(interaction, await executeRoster(workerClient));
}

async function handleStats(interaction: ChatInputCommandInteraction, workerClient: WorkerClient): Promise<void> {
  const member = interaction.options.getString("member", false) ?? undefined;
  await safeReply(interaction, await executeStats(workerClient, interaction.user.id, member));
}

async function handleReminders(interaction: ChatInputCommandInteraction, workerClient: WorkerClient): Promise<void> {
  const mode = parseReminderMode(interaction.options.getString("mode", true));
  if (!mode) {
    await safeReply(interaction, "Usage: /reminders <on|off>");
    return;
  }
  await safeReply(interaction, await executeReminders(workerClient, interaction.user.id, mode));
}

export async function registerSlashCommands(config: BotRuntimeConfig): Promise<void> {
  if (!config.discordToken || !config.discordClientId) {
    return;
  }

  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const payload = buildSlashCommandPayload();

  if (config.discordGuildId) {
    await rest.put(Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId), {
      body: payload,
    });
    return;
  }

  await rest.put(Routes.applicationCommands(config.discordClientId), {
    body: payload,
  });
}

export function attachCommandHandlers(client: Client, workerClient: WorkerClient): void {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }
      switch (interaction.commandName) {
        case "signup":
          await handleSignup(interaction, workerClient);
          return;
        case "leave":
          await handleLeave(interaction, workerClient);
          return;
        case "link":
          await handleLink(interaction, workerClient);
          return;
        case "verify":
          await handleVerify(interaction, workerClient);
          return;
        case "events":
          await handleEvents(interaction, workerClient);
          return;
        case "teams":
          await handleTeams(interaction, workerClient);
          return;
        case "roster":
          await handleRoster(interaction, workerClient);
          return;
        case "stats":
          await handleStats(interaction, workerClient);
          return;
        case "reminders":
          await handleReminders(interaction, workerClient);
          return;
        default:
          await safeReply(interaction, "Unknown command.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Command failed";
      await safeReply(interaction, message);
    }
  });
}
