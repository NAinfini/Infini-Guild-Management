import { EVENT_TYPES, type Event, type EventClassQuotaInput } from "@guild/shared";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useCallback, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useBeforeUnloadPrompt } from "../../../hooks/useBeforeUnloadPrompt";
import { toClassQuotaInputs } from "./class-quota-view";

type EditorSnapshot = {
  mode: "create" | "edit";
  editingEventId: string | null;
  type: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  capacity: string;
  pinned: boolean;
  signupLocked: boolean;
  autoArchive: boolean;
  pollOptions: string[];
  pollResultsVisibility: "always" | "after_vote" | "after_close";
  pollShowVoterNames: boolean;
  winnerCount: string;
  classQuotas: EventClassQuotaInput[];
  attachmentSnapshot: string;
};

function buildEditorSnapshot(input: EditorSnapshot): string {
  return JSON.stringify({
    ...input,
    title: input.title.trim(),
    description: input.description.trim(),
    capacity: input.capacity.trim(),
  });
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const shifted = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function toIso(input: string): string | undefined {
  if (!input.trim()) return undefined;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

type UseEventsEditorControllerParams = {
  attachmentSnapshot: string;
};

export function useEventsEditorController({ attachmentSnapshot }: UseEventsEditorControllerParams) {
  const { t } = useTranslation("events");
  const confirm = useConfirmDialog();
  const [editorOpen, editorHandlers] = useDisclosure(false);
  const [editorTouched, setEditorTouched] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editorType, setEditorType] = useState<(typeof EVENT_TYPES)[number] | "">("");
  const [editorTitle, setEditorTitle] = useState("");
  const [editorDescription, setEditorDescription] = useState("");
  const [editorStartAt, setEditorStartAt] = useState("");
  const [editorEndAt, setEditorEndAt] = useState("");
  const [editorCapacity, setEditorCapacity] = useState("");
  const [editorPinned, setEditorPinned] = useState(false);
  const [editorSignupLocked, setEditorSignupLocked] = useState(false);
  const [editorAutoArchive, setEditorAutoArchive] = useState(false);
  const [editorPollOptions, setEditorPollOptions] = useState<string[]>(["", ""]);
  const [editorPollResultsVisibility, setEditorPollResultsVisibility] = useState<"always" | "after_vote" | "after_close">("after_vote");
  const [editorPollShowVoterNames, setEditorPollShowVoterNames] = useState(false);
  const [editorWinnerCount, setEditorWinnerCount] = useState("");
  const [editorClassQuotas, setEditorClassQuotas] = useState<EventClassQuotaInput[]>([]);
  const [editorBaseline, setEditorBaseline] = useState<string | null>(null);

  const editorStartIso = toIso(editorStartAt);
  const editorEndIso = toIso(editorEndAt) ?? editorStartIso;

  const editorCurrentSnapshot = buildEditorSnapshot({
    mode: editorMode,
    editingEventId,
    type: editorType,
    title: editorTitle,
    description: editorDescription,
    startAt: editorStartAt,
    endAt: editorEndAt,
    capacity: editorCapacity,
    pinned: editorPinned,
    signupLocked: editorSignupLocked,
    autoArchive: editorAutoArchive,
    pollOptions: editorPollOptions,
    pollResultsVisibility: editorPollResultsVisibility,
    pollShowVoterNames: editorPollShowVoterNames,
    winnerCount: editorWinnerCount,
    classQuotas: editorClassQuotas,
    attachmentSnapshot,
  });
  const isEditorDirty = editorOpen && editorBaseline !== null && editorTouched && editorCurrentSnapshot !== editorBaseline;
  useBeforeUnloadPrompt(isEditorDirty);

  const markEditorTouched = useCallback(() => {
    setEditorTouched(true);
  }, []);

  const handleEditorTypeChange = useCallback((value: (typeof EVENT_TYPES)[number] | "") => {
    setEditorTouched(true);
    setEditorType(value);
  }, []);

  const handleEditorTitleChange = useCallback((value: string) => {
    setEditorTouched(true);
    setEditorTitle(value);
  }, []);

  const handleEditorDescriptionChange = useCallback((value: string) => {
    setEditorTouched(true);
    setEditorDescription(value);
  }, []);

  const handleEditorStartAtChange = useCallback((value: string) => {
    setEditorTouched(true);
    setEditorStartAt(value);
  }, []);

  const handleEditorEndAtChange = useCallback((value: string) => {
    setEditorTouched(true);
    setEditorEndAt(value);
  }, []);

  const handleEditorCapacityChange = useCallback((value: string) => {
    setEditorTouched(true);
    setEditorCapacity(value);
  }, []);

  const handleEditorAutoArchiveChange = useCallback((value: boolean) => {
    setEditorTouched(true);
    setEditorAutoArchive(value);
  }, []);

  const handleEditorPollOptionsChange = useCallback((value: string[]) => {
    setEditorTouched(true);
    setEditorPollOptions(value);
  }, []);

  const handleEditorPollResultsVisibilityChange = useCallback((value: "always" | "after_vote" | "after_close") => {
    setEditorTouched(true);
    setEditorPollResultsVisibility(value);
  }, []);

  const handleEditorPollShowVoterNamesChange = useCallback((value: boolean) => {
    setEditorTouched(true);
    setEditorPollShowVoterNames(value);
  }, []);

  const handleEditorWinnerCountChange = useCallback((value: string) => {
    setEditorTouched(true);
    setEditorWinnerCount(value);
  }, []);

  const handleEditorClassQuotasChange = useCallback((value: EventClassQuotaInput[]) => {
    setEditorTouched(true);
    setEditorClassQuotas(value);
  }, []);

  const openCreateEditor = useCallback((initialDateKey?: string) => {
    const now = new Date();
    const fallbackStart = new Date(now.getTime() + 60 * 60_000);
    const dateStart = initialDateKey ? new Date(`${initialDateKey}T20:00:00`) : fallbackStart;
    const initialStartAt = toLocalInput(
      Number.isNaN(dateStart.getTime()) ? fallbackStart.toISOString() : dateStart.toISOString(),
    );
    setEditorTouched(false);
    setEditorMode("create");
    setEditingEventId(null);
    setEditorType("");
    setEditorTitle("");
    setEditorDescription("");
    const initialEndAt = toLocalInput(
      new Date(
        (Number.isNaN(dateStart.getTime()) ? fallbackStart : dateStart).getTime() + 2 * 60 * 60_000,
      ).toISOString(),
    );
    setEditorStartAt(initialStartAt);
    setEditorEndAt(initialEndAt);
    setEditorCapacity("");
    setEditorPinned(false);
    setEditorSignupLocked(false);
    setEditorAutoArchive(false);
    setEditorPollOptions(["", ""]);
    setEditorPollResultsVisibility("after_vote");
    setEditorPollShowVoterNames(false);
    setEditorWinnerCount("");
    setEditorClassQuotas([]);
    setEditorBaseline(
      buildEditorSnapshot({
        mode: "create",
        editingEventId: null,
        type: "",
        title: "",
        description: "",
        startAt: initialStartAt,
        endAt: initialEndAt,
        capacity: "",
        pinned: false,
        signupLocked: false,
        autoArchive: false,
        pollOptions: ["", ""],
        pollResultsVisibility: "after_vote",
        pollShowVoterNames: false,
        winnerCount: "",
        classQuotas: [],
        attachmentSnapshot: "[]",
      }),
    );
    editorHandlers.open();
  }, []);

  const openEditEditor = useCallback((event: Event, initialAttachmentSnapshot?: string) => {
    const startAt = toLocalInput(event.start_at);
    const endAt = toLocalInput(event.end_at);
    const capacity = event.capacity === null ? "" : String(event.capacity);

    setEditorTouched(false);
    setEditorMode("edit");
    setEditingEventId(event.id);
    setEditorType(event.type);
    setEditorTitle(event.title);
    setEditorDescription(event.description ?? "");
    setEditorStartAt(startAt);
    setEditorEndAt(endAt);
    setEditorCapacity(capacity);
    setEditorPinned(event.pinned);
    setEditorSignupLocked(event.signup_locked);
    setEditorAutoArchive(event.auto_archive);
    setEditorPollOptions(event.poll?.options.map((option) => option.label) ?? ["", ""]);
    setEditorPollResultsVisibility(event.poll?.results_visibility ?? "after_vote");
    setEditorPollShowVoterNames(event.poll?.show_voter_names ?? false);
    const winnerCountStr = event.winner_count != null ? String(event.winner_count) : "";
    setEditorWinnerCount(winnerCountStr);
    /* 服务端已经按标签顺序排好，这里原样接住——顺序变化也算改动，不该被悄悄抹平。 */
    const classQuotas = toClassQuotaInputs(event.class_quotas);
    setEditorClassQuotas(classQuotas);
    setEditorBaseline(
      buildEditorSnapshot({
        mode: "edit",
        editingEventId: event.id,
        type: event.type,
        title: event.title,
        description: event.description ?? "",
        startAt,
        endAt,
        capacity,
        pinned: event.pinned,
        signupLocked: event.signup_locked,
        autoArchive: event.auto_archive,
        pollOptions: event.poll?.options.map((option) => option.label) ?? ["", ""],
        pollResultsVisibility: event.poll?.results_visibility ?? "after_vote",
        pollShowVoterNames: event.poll?.show_voter_names ?? false,
        winnerCount: winnerCountStr,
        classQuotas,
        attachmentSnapshot: initialAttachmentSnapshot ?? "[]",
      }),
    );
    editorHandlers.open();
  }, []);

  const closeEditor = useCallback(async () => {
    if (isEditorDirty) {
      const confirmed = await confirm({
        title: t("confirm.discardUnsaved.title"),
        description: t("confirm.discardUnsaved.description"),
        confirmLabel: t("common:action.delete"),
        cancelLabel: t("common:action.cancel"),
        intent: "warning",
      });
      if (!confirmed) {
        return false;
      }
    }
    editorHandlers.close();
    setEditorTouched(false);
    setEditorBaseline(null);
    return true;
  }, [confirm, isEditorDirty, t]);
  const closeEditorAfterSave = useCallback(() => {
    editorHandlers.close();
    setEditorTouched(false);
    setEditorBaseline(null);
  }, []);

  return {
    editorOpen,
    editorMode,
    editingEventId,
    editorType,
    editorTitle,
    editorDescription,
    editorStartAt,
    editorEndAt,
    editorCapacity,
    editorPinned,
    editorSignupLocked,
    editorAutoArchive,
    editorPollOptions,
    editorPollResultsVisibility,
    editorPollShowVoterNames,
    editorWinnerCount,
    editorClassQuotas,
    editorStartIso,
    editorEndIso,
    isEditorDirty,
    setEditorType: handleEditorTypeChange,
    setEditorTitle: handleEditorTitleChange,
    setEditorDescription: handleEditorDescriptionChange,
    setEditorStartAt: handleEditorStartAtChange,
    setEditorEndAt: handleEditorEndAtChange,
    setEditorCapacity: handleEditorCapacityChange,
    markEditorTouched,
    setEditorPinned,
    setEditorSignupLocked,
    setEditorAutoArchive: handleEditorAutoArchiveChange,
    setEditorPollOptions: handleEditorPollOptionsChange,
    setEditorPollResultsVisibility: handleEditorPollResultsVisibilityChange,
    setEditorPollShowVoterNames: handleEditorPollShowVoterNamesChange,
    setEditorWinnerCount: handleEditorWinnerCountChange,
    setEditorClassQuotas: handleEditorClassQuotasChange,
    openCreateEditor,
    openEditEditor,
    closeEditor,
    closeEditorAfterSave,
  };
}
