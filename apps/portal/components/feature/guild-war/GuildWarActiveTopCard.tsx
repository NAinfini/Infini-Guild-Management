import { Button, Divider, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import { MotionButton } from "@infini-dev-kit/frontend/components";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { useTranslation } from "react-i18next";

type GuildWarActiveTopCardProps = {
  selectedEventId: string | undefined;
  eventOptions: Array<{ value: string; label: string }>;
  eventPlaceholder: string;
  onSelectedEventIdChange: (value: string) => void;
  canManage: boolean;
  onInitTeams: () => void;
  initTeamsPending: boolean;
  canInitTeams: boolean;
  onPostTeams: (platform: "discord" | "wechat") => void;
  postTeamsPending: boolean;
  activeSearch: string;
  onActiveSearchChange: (value: string) => void;
  matchLabel: string;
  onPrevMatch: () => void;
  onNextMatch: () => void;
  hasMatches: boolean;
  searchPlaceholder: string;
  initTeamsLabel: string;
  selectedTemplateId: string;
  templateOptions: Array<{ value: string; label: string }>;
  templatePlaceholder: string;
  templateName: string;
  templateNamePlaceholder: string;
  onTemplateNameChange: (value: string) => void;
  templateDescription: string;
  templateDescriptionPlaceholder: string;
  onTemplateDescriptionChange: (value: string) => void;
  onSelectedTemplateIdChange: (value: string) => void;
  onSaveTemplate: () => void;
  onApplyTemplate: () => void;
  onDeleteTemplate: () => void;
  saveTemplateLabel: string;
  applyTemplateLabel: string;
  deleteTemplateLabel: string;
  templateSavePending: boolean;
  templateApplyPending: boolean;
  templateDeletePending: boolean;
  templateActionDisabled: boolean;
};

export function GuildWarActiveTopCard({
  selectedEventId,
  eventOptions,
  eventPlaceholder,
  onSelectedEventIdChange,
  canManage,
  onInitTeams,
  initTeamsPending,
  canInitTeams,
  onPostTeams,
  postTeamsPending,
  activeSearch,
  onActiveSearchChange,
  matchLabel,
  onPrevMatch,
  onNextMatch,
  hasMatches,
  searchPlaceholder,
  initTeamsLabel,
  selectedTemplateId,
  templateOptions,
  templatePlaceholder,
  templateName,
  templateNamePlaceholder,
  onTemplateNameChange,
  templateDescription,
  templateDescriptionPlaceholder,
  onTemplateDescriptionChange,
  onSelectedTemplateIdChange,
  onSaveTemplate,
  onApplyTemplate,
  onDeleteTemplate,
  saveTemplateLabel,
  applyTemplateLabel,
  deleteTemplateLabel,
  templateSavePending,
  templateApplyPending,
  templateDeletePending,
  templateActionDisabled,
}: GuildWarActiveTopCardProps) {
  const { t } = useTranslation("guild-war");
  return (
    <InfiniCard interactive={false} className="guild-war-active-top-card">
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={12}>
          {/* Row 1: Event selector + actions */}
          <Group gap={10} wrap="wrap" align="center">
            <Select
              style={{ flex: "1 1 240px", maxWidth: 320 }}
              value={selectedEventId ?? null}
              placeholder={eventPlaceholder}
              aria-label="Select guild war event"
              onChange={(value) => onSelectedEventIdChange(value ?? "")}
              data={eventOptions}
            />
            {canManage ? (
              <>
                <MotionButton onClick={onInitTeams} loading={initTeamsPending} disabled={!canInitTeams}>
                  {initTeamsLabel}
                </MotionButton>
                <MotionButton onClick={() => onPostTeams("discord")} loading={postTeamsPending} disabled={!selectedEventId}>
                  {t("active.postDiscord")}
                </MotionButton>
                <MotionButton onClick={() => onPostTeams("wechat")} loading={postTeamsPending} disabled={!selectedEventId}>
                  {t("active.postWechat")}
                </MotionButton>
              </>
            ) : null}
          </Group>

          {/* Row 2: Search + navigation */}
          <Group gap={10} wrap="wrap" align="center">
            <TextInput
              style={{ flex: "1 1 200px", maxWidth: 320 }}
              value={activeSearch}
              onChange={(event) => onActiveSearchChange(event.currentTarget.value)}
              placeholder={searchPlaceholder}
              aria-label="Search active guild war members"
            />
            <Group gap={6} wrap="nowrap" align="center">
              <Button size="xs" variant="light" onClick={onPrevMatch} disabled={!hasMatches}>
                {t("active.prev")}
              </Button>
              <Button size="xs" variant="light" onClick={onNextMatch} disabled={!hasMatches}>
                {t("active.next")}
              </Button>
              <Text c="dimmed" size="sm" style={{ whiteSpace: "nowrap" }}>{matchLabel}</Text>
            </Group>
          </Group>

          {/* Row 3: Template management (admin only) */}
          {canManage ? (
            <>
              <Divider
                color="color-mix(in srgb, var(--infini-color-text, #111827) 10%, transparent)"
              />
              <Group gap={10} wrap="wrap" align="flex-end">
                <Select
                  style={{ flex: "1 1 200px", maxWidth: 280 }}
                  value={selectedTemplateId || null}
                  placeholder={templatePlaceholder}
                  aria-label="Select guild war template"
                  onChange={(value) => onSelectedTemplateIdChange(value ?? "")}
                  data={templateOptions}
                />
                <TextInput
                  style={{ flex: "1 1 160px", maxWidth: 220 }}
                  value={templateName}
                  onChange={(event) => onTemplateNameChange(event.currentTarget.value)}
                  placeholder={templateNamePlaceholder}
                  aria-label="Guild war template name"
                />
                <TextInput
                  style={{ flex: "1 1 200px", maxWidth: 280 }}
                  value={templateDescription}
                  onChange={(event) => onTemplateDescriptionChange(event.currentTarget.value)}
                  placeholder={templateDescriptionPlaceholder}
                  aria-label="Guild war template description"
                />
              </Group>
              <Group gap={8} wrap="wrap">
                <MotionButton
                  onClick={onSaveTemplate}
                  loading={templateSavePending}
                  disabled={templateActionDisabled || templateName.trim().length === 0}
                >
                  {saveTemplateLabel}
                </MotionButton>
                <MotionButton
                  onClick={onApplyTemplate}
                  loading={templateApplyPending}
                  disabled={templateActionDisabled || !selectedTemplateId}
                >
                  {applyTemplateLabel}
                </MotionButton>
                <Button
                  variant="light"
                  color="infini-danger"
                  onClick={onDeleteTemplate}
                  loading={templateDeletePending}
                  disabled={templateActionDisabled || !selectedTemplateId}
                >
                  {deleteTemplateLabel}
                </Button>
              </Group>
            </>
          ) : null}
        </Stack>
      </div>
    </InfiniCard>
  );
}

