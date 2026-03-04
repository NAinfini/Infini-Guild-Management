import { Button, Group, Select, Text, TextInput } from "@mantine/core";
import { MotionButton } from "@infini-dev-kit/frontend/components";
import { InfiniCard } from "@infini-dev-kit/frontend/components";

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
  return (
    <InfiniCard className="guild-war-active-top-card">
      <div style={{ padding: "1.2rem" }}>
      <div className="guild-war-active-top-row">
        <Group gap={8} wrap="wrap">
          <Select
            style={{ width: 280 }}
            value={selectedEventId ?? null}
            placeholder={eventPlaceholder}
            aria-label="Select guild war event"
            onChange={(value) => onSelectedEventIdChange(value ?? "")}
            data={eventOptions}
          />
          <TextInput
            style={{ width: 280, minWidth: 200 }}
            value={activeSearch}
            onChange={(event) => onActiveSearchChange(event.currentTarget.value)}
            placeholder={searchPlaceholder}
            aria-label="Search active guild war members"
          />
          <Text c="dimmed" style={{ whiteSpace: "nowrap" }}>{matchLabel}</Text>
          <Button onClick={onPrevMatch} disabled={!hasMatches}>
            Prev
          </Button>
          <Button onClick={onNextMatch} disabled={!hasMatches}>
            Next
          </Button>
          {canManage ? (
            <MotionButton onClick={onInitTeams} loading={initTeamsPending} disabled={!canInitTeams}>
              {initTeamsLabel}
            </MotionButton>
          ) : null}
          {canManage ? (
            <>
              <MotionButton onClick={() => onPostTeams("discord")} loading={postTeamsPending} disabled={!selectedEventId}>
                Post to Discord
              </MotionButton>
              <MotionButton onClick={() => onPostTeams("wechat")} loading={postTeamsPending} disabled={!selectedEventId}>
                Post to WeChat
              </MotionButton>
            </>
          ) : null}
        </Group>
        {canManage ? (
          <Group gap={8} wrap="wrap">
            <Select
              style={{ width: 280 }}
              value={selectedTemplateId || null}
              placeholder={templatePlaceholder}
              aria-label="Select guild war template"
              onChange={(value) => onSelectedTemplateIdChange(value ?? "")}
              data={templateOptions}
            />
            <TextInput
              style={{ width: 200 }}
              value={templateName}
              onChange={(event) => onTemplateNameChange(event.currentTarget.value)}
              placeholder={templateNamePlaceholder}
              aria-label="Guild war template name"
            />
            <TextInput
              style={{ width: 260 }}
              value={templateDescription}
              onChange={(event) => onTemplateDescriptionChange(event.currentTarget.value)}
              placeholder={templateDescriptionPlaceholder}
              aria-label="Guild war template description"
            />
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
              color="red"
              onClick={onDeleteTemplate}
              loading={templateDeletePending}
              disabled={templateActionDisabled || !selectedTemplateId}
            >
              {deleteTemplateLabel}
            </Button>
          </Group>
        ) : null}
      </div>
      </div>
    </InfiniCard>
  );
}
