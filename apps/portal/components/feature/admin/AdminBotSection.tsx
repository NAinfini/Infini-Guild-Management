import { Alert, Badge, Button, Divider, Group, Loader, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea, Title } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { IconDeviceFloppy, IconRefresh, IconSend } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { hasRoleAtLeast } from "@guild/shared";
import { useAuthStore } from "../../../stores/auth";

type Option = {
  value: string;
  label: string;
};

type AdminBotSectionProps = {
  botSettingsLoading: boolean;
  botSettingsError: boolean;
  runtimeStatus: string | null;
  onTestDispatch: (platform: "discord" | "wechat") => void;
  testDispatchPending: boolean;
  discordGuildId: string;
  onDiscordGuildIdChange: (value: string) => void;
  onRefreshChannels: () => void;
  discordChannelsFetching: boolean;
  canRefreshChannels: boolean;
  discordChannelCount: number;
  discordChannelsError: boolean;
  discordNotificationChannelId: string;
  onDiscordNotificationChannelIdChange: (value: string) => void;
  discordTeamCompChannelId: string;
  onDiscordTeamCompChannelIdChange: (value: string) => void;
  discordChannelOptions: Option[];
  discordChannelsLoading: boolean;
  botToggleKeys: string[];
  discordDefaultToggles: Record<string, boolean>;
  onDiscordDefaultToggleChange: (key: string, checked: boolean) => void;
  wechatRoomIdsText: string;
  onWechatRoomIdsTextChange: (value: string) => void;
  wechatDefaultToggles: Record<string, boolean>;
  onWechatDefaultToggleChange: (key: string, checked: boolean) => void;
  botSettingsJson: string;
  onBotSettingsJsonChange: (value: string) => void;
  onSaveBotSettings: () => void;
  savePending: boolean;
};

const TOGGLE_LABEL_MAP: Record<string, string> = {
  event_notify: "bot.toggle.eventNotify",
  team_comp: "bot.toggle.teamComp",
  reminder: "bot.toggle.reminder",
  war_result: "bot.toggle.warResult",
};

function ToggleLabel({ toggleKey }: { toggleKey: string }) {
  const { t } = useTranslation("admin");
  const i18nKey = TOGGLE_LABEL_MAP[toggleKey];
  return <>{i18nKey ? t(i18nKey) : toggleKey}</>;
}

export function AdminBotSection({
  botSettingsLoading,
  botSettingsError,
  runtimeStatus,
  onTestDispatch,
  testDispatchPending,
  discordGuildId,
  onDiscordGuildIdChange,
  onRefreshChannels,
  discordChannelsFetching,
  canRefreshChannels,
  discordChannelCount,
  discordChannelsError,
  discordNotificationChannelId,
  onDiscordNotificationChannelIdChange,
  discordTeamCompChannelId,
  onDiscordTeamCompChannelIdChange,
  discordChannelOptions,
  discordChannelsLoading,
  botToggleKeys,
  discordDefaultToggles,
  onDiscordDefaultToggleChange,
  wechatRoomIdsText,
  onWechatRoomIdsTextChange,
  wechatDefaultToggles,
  onWechatDefaultToggleChange,
  botSettingsJson,
  onBotSettingsJsonChange,
  onSaveBotSettings,
  savePending,
}: AdminBotSectionProps) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const user = useAuthStore((state) => state.user);
  const isAdmin = Boolean(user && hasRoleAtLeast(user.role, "admin"));
  const loadErrorMessage = tc("loadError");
  const heading = <Title order={3} style={{ margin: 0, fontSize: 16 }}>{t("tab.bot")}</Title>;
  const saveLabel = t("bot.save");
  if (!isAdmin) {
    return (
      <Stack gap={12}>
        {heading}
        <Alert color="infini-warning" title={t("adminOnly")} />
      </Stack>
    );
  }

  return (
    <Stack gap={16}>
      {heading}
      {botSettingsLoading ? <Loader size="sm" /> : null}
      {botSettingsError ? <Alert color="infini-warning" title={loadErrorMessage} /> : null}
      {!botSettingsLoading && !botSettingsError ? (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={16}>
          {/* ── Discord ── */}
          <InfiniCard interactive={false}>
            <Stack gap={16} p="1.2rem">
              <Group justify="space-between" align="center">
                <Group gap={8}>
                  <Text fw={700} size="md">{t("bot.discord")}</Text>
                  <Badge
                    size="sm"
                    color={runtimeStatus === "ok" ? "green" : "yellow"}
                    variant="light"
                  >
                    {runtimeStatus ?? t("status.summary.unknown")}
                  </Badge>
                </Group>
                <Group gap={6} wrap="nowrap">
                  <Button
                    size="compact-xs"
                    variant="light"
                    leftSection={<IconSend size={16} />}
                    onClick={() => onTestDispatch("discord")}
                    loading={testDispatchPending}
                  >
                    {t("bot.testNotification")}
                  </Button>
                  <Badge size="xs" color="yellow" variant="light">{t("bot.dryRun")}</Badge>
                </Group>
              </Group>

              <Divider label={t("bot.section.connection")} labelPosition="left" />

              <TextInput
                label={t("bot.guildIdLabel")}
                value={discordGuildId}
                onChange={(event) => onDiscordGuildIdChange(event.currentTarget.value)}
                placeholder={t("bot.guildIdPlaceholder")}
                aria-label={t("bot.aria.guildId")}
              />

              <Group gap={8} align="center">
                <Button
                  size="compact-xs"
                  variant="default"
                  leftSection={<IconRefresh size={16} />}
                  onClick={onRefreshChannels}
                  loading={discordChannelsFetching}
                  disabled={!canRefreshChannels}
                >
                  {t("bot.refreshChannels")}
                </Button>
                {discordChannelCount > 0 ? (
                  <Text c="dimmed" size="xs">{t("bot.channelsLoaded", { count: discordChannelCount })}</Text>
                ) : null}
              </Group>

              {discordChannelsError ? <Alert color="infini-warning" title={loadErrorMessage} /> : null}

              <Divider label={t("bot.section.channels")} labelPosition="left" />

              <Select
                searchable
                label={t("bot.notificationChannel")}
                value={discordNotificationChannelId || null}
                onChange={(value) => onDiscordNotificationChannelIdChange(value ?? "")}
                placeholder={discordGuildId.trim() ? t("bot.selectChannel") : t("bot.enterGuildIdFirst")}
                aria-label={t("bot.aria.notificationChannel")}
                data={discordChannelOptions}
                disabled={!discordGuildId.trim()}
                rightSection={discordChannelsLoading || discordChannelsFetching ? <Loader size={14} /> : undefined}
              />

              <Select
                searchable
                label={t("bot.teamCompChannel")}
                value={discordTeamCompChannelId || null}
                onChange={(value) => onDiscordTeamCompChannelIdChange(value ?? "")}
                placeholder={discordGuildId.trim() ? t("bot.selectChannel") : t("bot.enterGuildIdFirst")}
                aria-label={t("bot.aria.teamCompChannel")}
                data={discordChannelOptions}
                disabled={!discordGuildId.trim()}
                rightSection={discordChannelsLoading || discordChannelsFetching ? <Loader size={14} /> : undefined}
              />

              <Divider label={t("bot.section.features")} labelPosition="left" />

              <Stack gap={10}>
                {botToggleKeys.map((key) => (
                  <Switch
                    key={`discord-${key}`}
                    checked={Boolean(discordDefaultToggles[key])}
                    onChange={(event) => onDiscordDefaultToggleChange(key, event.currentTarget.checked)}
                    label={<ToggleLabel toggleKey={key} />}
                    aria-label={t("bot.aria.discordToggle", { key })}
                    size="sm"
                  />
                ))}
              </Stack>
            </Stack>
          </InfiniCard>

          {/* ── WeChat ── */}
          <InfiniCard interactive={false}>
            <Stack gap={16} p="1.2rem">
              <Group justify="space-between" align="center">
                <Text fw={700} size="md">{t("bot.wechat")}</Text>
                <Group gap={6} wrap="nowrap">
                  <Button
                    size="compact-xs"
                    variant="light"
                    leftSection={<IconSend size={16} />}
                    onClick={() => onTestDispatch("wechat")}
                    loading={testDispatchPending}
                  >
                    {t("bot.testMessage")}
                  </Button>
                  <Badge size="xs" color="yellow" variant="light">{t("bot.dryRun")}</Badge>
                </Group>
              </Group>

              <Divider label={t("bot.section.connection")} labelPosition="left" />

              <TextInput
                label={t("bot.roomIdsLabel")}
                value={wechatRoomIdsText}
                onChange={(event) => onWechatRoomIdsTextChange(event.currentTarget.value)}
                placeholder={t("bot.roomIdsPlaceholder")}
                aria-label={t("bot.aria.wechatRoomIds")}
              />

              <Divider label={t("bot.section.features")} labelPosition="left" />

              <Stack gap={10}>
                {botToggleKeys.map((key) => (
                  <Switch
                    key={`wechat-${key}`}
                    checked={Boolean(wechatDefaultToggles[key])}
                    onChange={(event) => onWechatDefaultToggleChange(key, event.currentTarget.checked)}
                    label={<ToggleLabel toggleKey={key} />}
                    aria-label={t("bot.aria.wechatToggle", { key })}
                    size="sm"
                  />
                ))}
              </Stack>
            </Stack>
          </InfiniCard>

          {/* ── JSON Preview (full width) ── */}
          <InfiniCard interactive={false} style={{ gridColumn: "1 / -1" }}>
            <Stack gap={12} p="1.2rem">
              <Text fw={700} size="md">{t("bot.jsonPreview")}</Text>
              <Textarea
                minRows={8}
                autosize
                maxRows={20}
                value={botSettingsJson}
                aria-label={t("bot.aria.jsonPreview")}
                onChange={(event) => onBotSettingsJsonChange(event.currentTarget.value)}
                styles={{ input: { fontFamily: "monospace", fontSize: "0.82rem" } }}
              />
              <Group justify="flex-end">
                <Button leftSection={<IconDeviceFloppy size={16} />} onClick={onSaveBotSettings} loading={savePending}>
                  {saveLabel}
                </Button>
              </Group>
            </Stack>
          </InfiniCard>
        </SimpleGrid>
      ) : null}
    </Stack>
  );
}
