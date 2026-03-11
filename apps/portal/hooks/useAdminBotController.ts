import { notifications } from "@mantine/notifications";
import { useEffect, useMemo, useReducer } from "react";
import { useTranslation } from "react-i18next";
import { copyPlainText } from "../utils/copy";

export type BotSettingsState = {
  json: string;
  discordGuildId: string;
  discordNotificationChannelId: string;
  discordTeamCompChannelId: string;
  discordDefaultToggles: Record<string, boolean>;
  wechatRoomIdsText: string;
  wechatDefaultToggles: Record<string, boolean>;
};

type BotSettingsAction =
  | { type: "SET_JSON"; value: string }
  | { type: "SET_DISCORD_GUILD_ID"; value: string }
  | { type: "SET_DISCORD_NOTIFICATION_CHANNEL_ID"; value: string }
  | { type: "SET_DISCORD_TEAM_COMP_CHANNEL_ID"; value: string }
  | { type: "SET_DISCORD_TOGGLE"; key: string; checked: boolean }
  | { type: "SET_WECHAT_ROOM_IDS_TEXT"; value: string }
  | { type: "SET_WECHAT_TOGGLE"; key: string; checked: boolean }
  | { type: "LOAD_FROM_API"; data: BotSettingsState };

type BotSettingsData = {
  discord: {
    guild_id: string;
    notification_channel_id: string;
    team_comp_channel_id: string;
    default_toggles: Record<string, boolean>;
  };
  wechat: {
    room_ids: string[];
    default_toggles: Record<string, boolean>;
  };
};

type DiscordChannelsData = {
  channels: Array<{ id: string; name: string; type: string }>;
};

type AdminStatusData = {
  db: string;
  r2: string;
  ws: string;
  crons: string;
};

const BOT_SETTINGS_INITIAL: BotSettingsState = {
  json: "",
  discordGuildId: "",
  discordNotificationChannelId: "",
  discordTeamCompChannelId: "",
  discordDefaultToggles: {},
  wechatRoomIdsText: "",
  wechatDefaultToggles: {},
};

function botSettingsReducer(state: BotSettingsState, action: BotSettingsAction): BotSettingsState {
  switch (action.type) {
    case "SET_JSON":
      return { ...state, json: action.value };
    case "SET_DISCORD_GUILD_ID":
      return { ...state, discordGuildId: action.value };
    case "SET_DISCORD_NOTIFICATION_CHANNEL_ID":
      return { ...state, discordNotificationChannelId: action.value };
    case "SET_DISCORD_TEAM_COMP_CHANNEL_ID":
      return { ...state, discordTeamCompChannelId: action.value };
    case "SET_DISCORD_TOGGLE":
      return {
        ...state,
        discordDefaultToggles: {
          ...state.discordDefaultToggles,
          [action.key]: action.checked,
        },
      };
    case "SET_WECHAT_ROOM_IDS_TEXT":
      return { ...state, wechatRoomIdsText: action.value };
    case "SET_WECHAT_TOGGLE":
      return {
        ...state,
        wechatDefaultToggles: {
          ...state.wechatDefaultToggles,
          [action.key]: action.checked,
        },
      };
    case "LOAD_FROM_API":
      return action.data;
  }
}

type UseAdminBotControllerParams = {
  botSettingsData: BotSettingsData | undefined;
  discordChannelsData: DiscordChannelsData | undefined;
  statusData: AdminStatusData | undefined;
};

export function useAdminBotController({
  botSettingsData,
  discordChannelsData,
  statusData,
}: UseAdminBotControllerParams) {
  const { t } = useTranslation("admin");
  const [botSettings, dispatchBotSettings] = useReducer(botSettingsReducer, BOT_SETTINGS_INITIAL);

  useEffect(() => {
    if (!botSettingsData) {
      return;
    }
    dispatchBotSettings({
      type: "LOAD_FROM_API",
      data: {
        json: JSON.stringify(botSettingsData, null, 2),
        discordGuildId: botSettingsData.discord.guild_id,
        discordNotificationChannelId: botSettingsData.discord.notification_channel_id,
        discordTeamCompChannelId: botSettingsData.discord.team_comp_channel_id,
        discordDefaultToggles: botSettingsData.discord.default_toggles,
        wechatRoomIdsText: botSettingsData.wechat.room_ids.join(", "),
        wechatDefaultToggles: botSettingsData.wechat.default_toggles,
      },
    });
  }, [botSettingsData]);

  const botToggleKeys = useMemo(
    () =>
      Array.from(
        new Set([
          "event_notify",
          "team_comp",
          "reminder",
          "war_result",
          ...Object.keys(botSettings.discordDefaultToggles),
          ...Object.keys(botSettings.wechatDefaultToggles),
        ]),
      ),
    [botSettings.discordDefaultToggles, botSettings.wechatDefaultToggles],
  );

  const discordChannelOptions = useMemo(() => {
    const options = (discordChannelsData?.channels ?? []).map((channel) => ({
      value: channel.id,
      label: `#${channel.name} (${channel.type})`,
    }));
    const hasOption = (id: string) => options.some((option) => option.value === id);
    if (botSettings.discordNotificationChannelId && !hasOption(botSettings.discordNotificationChannelId)) {
      options.push({
        value: botSettings.discordNotificationChannelId,
        label: `#${botSettings.discordNotificationChannelId} (configured)`,
      });
    }
    if (botSettings.discordTeamCompChannelId && !hasOption(botSettings.discordTeamCompChannelId)) {
      options.push({
        value: botSettings.discordTeamCompChannelId,
        label: `#${botSettings.discordTeamCompChannelId} (configured)`,
      });
    }
    return options;
  }, [
    botSettings.discordNotificationChannelId,
    botSettings.discordTeamCompChannelId,
    discordChannelsData?.channels,
  ]);

  const copyConfigSummary = async () => {
    const lines = [
      t("status.summary.title"),
      t("status.summary.db", { value: statusData?.db ?? t("status.summary.unknown") }),
      t("status.summary.r2", { value: statusData?.r2 ?? t("status.summary.unknown") }),
      t("status.summary.ws", { value: statusData?.ws ?? t("status.summary.unknown") }),
      t("status.summary.crons", { value: statusData?.crons ?? t("status.summary.unknown") }),
      t("status.summary.discordGuild", { value: botSettingsData?.discord.guild_id ?? "" }),
      t("status.summary.discordNotifyChannel", { value: botSettingsData?.discord.notification_channel_id ?? "" }),
      t("status.summary.discordTeamChannel", { value: botSettingsData?.discord.team_comp_channel_id ?? "" }),
      t("status.summary.wechatRooms", { value: (botSettingsData?.wechat.room_ids ?? []).join(", ") }),
    ];
    await copyPlainText(lines.join("\n"));
    notifications.show({ color: "infini-success", message: t("message.configSummaryCopied") });
  };

  return {
    botSettings,
    botToggleKeys,
    discordChannelOptions,
    copyConfigSummary,
    setBotSettingsJson: (value: string) => dispatchBotSettings({ type: "SET_JSON", value }),
    setDiscordGuildId: (value: string) => dispatchBotSettings({ type: "SET_DISCORD_GUILD_ID", value }),
    setDiscordNotificationChannelId: (value: string) =>
      dispatchBotSettings({ type: "SET_DISCORD_NOTIFICATION_CHANNEL_ID", value }),
    setDiscordTeamCompChannelId: (value: string) =>
      dispatchBotSettings({ type: "SET_DISCORD_TEAM_COMP_CHANNEL_ID", value }),
    setDiscordDefaultToggle: (key: string, checked: boolean) =>
      dispatchBotSettings({ type: "SET_DISCORD_TOGGLE", key, checked }),
    setWechatRoomIdsText: (value: string) => dispatchBotSettings({ type: "SET_WECHAT_ROOM_IDS_TEXT", value }),
    setWechatDefaultToggle: (key: string, checked: boolean) =>
      dispatchBotSettings({ type: "SET_WECHAT_TOGGLE", key, checked }),
  };
}
