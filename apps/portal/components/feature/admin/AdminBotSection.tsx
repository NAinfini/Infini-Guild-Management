import { Alert, Badge, Button, Divider, Group, Loader, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { IconDeviceFloppy, IconRefresh, IconSend } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

type Option = {
  value: string;
  label: string;
};

type AdminBotSectionProps = {
  heading: ReactNode;
  isAdmin: boolean;
  adminOnlyMessage: string;
  botSettingsLoading: boolean;
  botSettingsError: boolean;
  loadErrorMessage: string;
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
  saveLabel: string;
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
  heading,
  isAdmin,
  adminOnlyMessage,
  botSettingsLoading,
  botSettingsError,
  loadErrorMessage,
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
  saveLabel,
}: AdminBotSectionProps) {
  const { t } = useTranslation("admin");
  if (!isAdmin) {
    return (
      <Stack gap={12}>
        {heading}
        <Alert color="infini-warning" title={adminOnlyMessage} />
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
            <Stack gap={16} style={{ padding: "1.2rem" }}>
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
                <Button
                  size="compact-xs"
                  variant="light"
                  leftSection={<IconSend size={16} />}
                  onClick={() => onTestDispatch("discord")}
                  loading={testDispatchPending}
                >
                  {t("bot.testNotification")}
                </Button>
              </Group>

              <Divider label={t("bot.section.connection")} labelPosition="left" />

              <TextInput
                label={t("bot.guildIdLabel")}
                value={discordGuildId}
                onChange={(event) => onDiscordGuildIdChange(event.currentTarget.value)}
                placeholder={t("bot.guildIdPlaceholder")}
                aria-label="Discord guild ID"
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
                aria-label="Discord notification channel"
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
                aria-label="Discord team composition channel"
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
                    aria-label={`Discord toggle ${key}`}
                    size="sm"
                  />
                ))}
              </Stack>
            </Stack>
          </InfiniCard>

          {/* ── WeChat ── */}
          <InfiniCard interactive={false}>
            <Stack gap={16} style={{ padding: "1.2rem" }}>
              <Group justify="space-between" align="center">
                <Text fw={700} size="md">{t("bot.wechat")}</Text>
                <Button
                  size="compact-xs"
                  variant="light"
                  leftSection={<IconSend size={16} />}
                  onClick={() => onTestDispatch("wechat")}
                  loading={testDispatchPending}
                >
                  {t("bot.testMessage")}
                </Button>
              </Group>

              <Divider label={t("bot.section.connection")} labelPosition="left" />

              <TextInput
                label={t("bot.roomIdsLabel")}
                value={wechatRoomIdsText}
                onChange={(event) => onWechatRoomIdsTextChange(event.currentTarget.value)}
                placeholder={t("bot.roomIdsPlaceholder")}
                aria-label="WeChat room IDs"
              />

              <Divider label={t("bot.section.features")} labelPosition="left" />

              <Stack gap={10}>
                {botToggleKeys.map((key) => (
                  <Switch
                    key={`wechat-${key}`}
                    checked={Boolean(wechatDefaultToggles[key])}
                    onChange={(event) => onWechatDefaultToggleChange(key, event.currentTarget.checked)}
                    label={<ToggleLabel toggleKey={key} />}
                    aria-label={`WeChat toggle ${key}`}
                    size="sm"
                  />
                ))}
              </Stack>
            </Stack>
          </InfiniCard>

          {/* ── JSON Preview (full width) ── */}
          <InfiniCard interactive={false} style={{ gridColumn: "1 / -1" }}>
            <Stack gap={12} style={{ padding: "1.2rem" }}>
              <Text fw={700} size="md">{t("bot.jsonPreview")}</Text>
              <Textarea
                minRows={8}
                autosize
                maxRows={20}
                value={botSettingsJson}
                aria-label="Bot settings JSON preview"
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
