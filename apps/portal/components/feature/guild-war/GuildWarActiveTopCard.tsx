import { Badge, Button, Divider, Group, Select, Stack, TextInput } from "@mantine/core";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { PortalCard } from "../../shared/PortalCard";
import { IconDeviceFloppy, IconTrash } from "@tabler/icons-react";

type GuildWarActiveTopCardProps = {
  selectedEventId: string | undefined;
  eventOptions: Array<{ value: string; label: string }>;
  eventPlaceholder: string;
  onSelectedEventIdChange: (value: string) => void;
  canManage: boolean;
  activeSearch: string;
  onActiveSearchChange: (value: string) => void;
  searchPlaceholder: string;
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
  matchLabel?: string;
  onPrevMatch?: () => void;
  onNextMatch?: () => void;
  hasMatches?: boolean;
  isTeamsDirty?: boolean;
  saveTeamsPending?: boolean;
  onSaveTeams?: () => void;
  saveTeamsLabel?: string;
  unsavedLabel?: string;
};

export function GuildWarActiveTopCard({
  selectedEventId,
  eventOptions,
  eventPlaceholder,
  onSelectedEventIdChange,
  canManage,
  activeSearch,
  onActiveSearchChange,
  searchPlaceholder,
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
  isTeamsDirty,
  saveTeamsPending,
  onSaveTeams,
  saveTeamsLabel,
  unsavedLabel,
}: GuildWarActiveTopCardProps) {
  return (
    <PortalCard interactive={false} className="guild-war-active-top-card">
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={12}>
          {/* Event selector + search + actions */}
          <Group gap={10} wrap="wrap" align="center">
            <TextInput
              style={{ flex: "1 1 200px", maxWidth: 320 }}
              value={activeSearch}
              onChange={(event) => onActiveSearchChange(event.currentTarget.value)}
              placeholder={searchPlaceholder}
              aria-label="Search active guild war members"
            />
            <Select
              style={{ flex: "0 1 320px", marginInlineStart: "auto" }}
              value={selectedEventId ?? null}
              placeholder={eventPlaceholder}
              aria-label="Select guild war event"
              onChange={(value) => onSelectedEventIdChange(value ?? "")}
              data={eventOptions}
            />
          </Group>

          {/* Save teams row (dirty indicator + save button) */}
          {canManage && onSaveTeams ? (
            <Group gap={8} wrap="wrap" align="center">
              {isTeamsDirty ? <Badge color="infini-warning">{unsavedLabel ?? "Unsaved"}</Badge> : null}
              <Button
                size="xs"
                variant="light"
                leftSection={<IconDeviceFloppy size={16} />}
                onClick={onSaveTeams}
                loading={saveTeamsPending}
                disabled={!isTeamsDirty}
              >
                {saveTeamsLabel ?? "Save Teams"}
              </Button>
            </Group>
          ) : null}

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
                <DepthButton
                  onClick={onSaveTemplate}
                  loading={templateSavePending}
                  disabled={templateActionDisabled || templateName.trim().length === 0}
                >
                  {saveTemplateLabel}
                </DepthButton>
                <DepthButton
                  onClick={onApplyTemplate}
                  loading={templateApplyPending}
                  disabled={templateActionDisabled || !selectedTemplateId}
                >
                  {applyTemplateLabel}
                </DepthButton>
                <Button
                  variant="light"
                  color="infini-danger"
                  leftSection={<IconTrash size={16} />}
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
    </PortalCard>
  );
}

