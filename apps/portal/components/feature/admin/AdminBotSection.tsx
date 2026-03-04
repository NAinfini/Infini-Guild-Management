import { Alert, Badge, Button, Checkbox, Group, Loader, Select, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import type { ReactNode } from "react";

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
  if (!isAdmin) {
    return (
      <Stack gap={12}>
        {heading}
        <Alert color="yellow" title={adminOnlyMessage} />
      </Stack>
    );
  }

  return (
    <Stack gap={12}>
      {heading}
      {botSettingsLoading ? <Loader size="sm" /> : null}
      {botSettingsError ? <Alert color="yellow" title={loadErrorMessage} /> : null}
      {!botSettingsLoading && !botSettingsError ? (
        <Stack gap={12}>
          <InfiniCard>
            <div style={{ padding: "1.2rem" }}>
              <Text fw={600} size="sm" mb={10}>Discord</Text>
              <Stack gap={10}>
                <Group wrap="wrap" gap={8}>
                  <Badge color={runtimeStatus === "ok" ? "green" : "yellow"} variant="light">
                    Runtime: {runtimeStatus ?? "unknown"}
                  </Badge>
                  <Button size="xs" onClick={() => onTestDispatch("discord")} loading={testDispatchPending}>
                    Test notification
                  </Button>
                </Group>

                <TextInput
                  value={discordGuildId}
                  onChange={(event) => onDiscordGuildIdChange(event.currentTarget.value)}
                  placeholder="Guild ID"
                  aria-label="Discord guild ID"
                />

                <Group wrap="wrap" gap={8}>
                  <Button
                    size="xs"
                    onClick={onRefreshChannels}
                    loading={discordChannelsFetching}
                    disabled={!canRefreshChannels}
                  >
                    Refresh channels
                  </Button>
                  {discordChannelCount > 0 ? (
                    <Text c="dimmed" size="sm">Loaded {discordChannelCount} channel(s)</Text>
                  ) : null}
                </Group>

                {discordChannelsError ? <Alert color="yellow" title={loadErrorMessage} /> : null}

                <Select
                  searchable
                  value={discordNotificationChannelId || null}
                  onChange={(value) => onDiscordNotificationChannelIdChange(value ?? "")}
                  placeholder={discordGuildId.trim() ? "Notification channel" : "Enter guild ID first"}
                  aria-label="Discord notification channel"
                  data={discordChannelOptions}
                  disabled={!discordGuildId.trim()}
                  rightSection={discordChannelsLoading || discordChannelsFetching ? <Loader size={14} /> : undefined}
                />

                <Select
                  searchable
                  value={discordTeamCompChannelId || null}
                  onChange={(value) => onDiscordTeamCompChannelIdChange(value ?? "")}
                  placeholder={discordGuildId.trim() ? "Team composition channel" : "Enter guild ID first"}
                  aria-label="Discord team composition channel"
                  data={discordChannelOptions}
                  disabled={!discordGuildId.trim()}
                  rightSection={discordChannelsLoading || discordChannelsFetching ? <Loader size={14} /> : undefined}
                />

                <Group wrap="wrap" gap={8}>
                  {botToggleKeys.map((key) => (
                    <Checkbox
                      key={`discord-${key}`}
                      checked={Boolean(discordDefaultToggles[key])}
                      onChange={(event) => onDiscordDefaultToggleChange(key, event.currentTarget.checked)}
                      label={key}
                      aria-label={`Discord toggle ${key}`}
                    />
                  ))}
                </Group>
              </Stack>
            </div>
          </InfiniCard>

          <InfiniCard>
            <div style={{ padding: "1.2rem" }}>
              <Text fw={600} size="sm" mb={10}>WeChat</Text>
              <Stack gap={10}>
                <Group wrap="wrap" gap={8}>
                  <Button size="xs" onClick={() => onTestDispatch("wechat")} loading={testDispatchPending}>
                    Test message
                  </Button>
                </Group>

                <TextInput
                  value={wechatRoomIdsText}
                  onChange={(event) => onWechatRoomIdsTextChange(event.currentTarget.value)}
                  placeholder="Room IDs (comma separated)"
                  aria-label="WeChat room IDs"
                />

                <Group wrap="wrap" gap={8}>
                  {botToggleKeys.map((key) => (
                    <Checkbox
                      key={`wechat-${key}`}
                      checked={Boolean(wechatDefaultToggles[key])}
                      onChange={(event) => onWechatDefaultToggleChange(key, event.currentTarget.checked)}
                      label={key}
                      aria-label={`WeChat toggle ${key}`}
                    />
                  ))}
                </Group>
              </Stack>
            </div>
          </InfiniCard>

          <InfiniCard>
            <div style={{ padding: "1.2rem" }}>
              <Text fw={600} size="sm" mb={10}>JSON Preview</Text>
              <Textarea
                minRows={8}
                value={botSettingsJson}
                aria-label="Bot settings JSON preview"
                onChange={(event) => onBotSettingsJsonChange(event.currentTarget.value)}
              />
            </div>
          </InfiniCard>

          <Button onClick={onSaveBotSettings} loading={savePending}>
            {saveLabel}
          </Button>
        </Stack>
      ) : null}
    </Stack>
  );
}

