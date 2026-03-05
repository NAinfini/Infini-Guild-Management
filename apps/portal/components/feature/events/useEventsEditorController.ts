import { EVENT_TYPES, type Event } from "@guild/shared";
import { modals } from "@mantine/modals";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBeforeUnloadPrompt } from "../../../hooks/useBeforeUnloadPrompt";

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
  recurrenceEnabled: boolean;
  recurrenceFreq: "daily" | "weekly" | "monthly";
  recurrenceInterval: string;
  recurrenceDays: number[];
  attachments: string[];
};

function buildEditorSnapshot(input: EditorSnapshot): string {
  return JSON.stringify({
    ...input,
    title: input.title.trim(),
    description: input.description.trim(),
    capacity: input.capacity.trim(),
    recurrenceInterval: input.recurrenceInterval.trim(),
    recurrenceDays: [...input.recurrenceDays].sort((left, right) => left - right),
    attachments: [...input.attachments].sort(),
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
  sortedEvents: Event[];
};

export function useEventsEditorController({ sortedEvents }: UseEventsEditorControllerParams) {
  const { t } = useTranslation("events");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editorType, setEditorType] = useState<(typeof EVENT_TYPES)[number]>(EVENT_TYPES[0] ?? "raid");
  const [editorTitle, setEditorTitle] = useState("");
  const [editorDescription, setEditorDescription] = useState("");
  const [editorStartAt, setEditorStartAt] = useState("");
  const [editorEndAt, setEditorEndAt] = useState("");
  const [editorCapacity, setEditorCapacity] = useState("");
  const [editorPinned, setEditorPinned] = useState(false);
  const [editorSignupLocked, setEditorSignupLocked] = useState(false);
  const [editorRecurrenceEnabled, setEditorRecurrenceEnabled] = useState(false);
  const [editorRecurrenceFreq, setEditorRecurrenceFreq] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [editorRecurrenceInterval, setEditorRecurrenceInterval] = useState("1");
  const [editorRecurrenceDays, setEditorRecurrenceDays] = useState<number[]>([1, 3, 5]);
  const [editorAttachments, setEditorAttachments] = useState<string[]>([]);
  const [editorRecurrenceApplyTo, setEditorRecurrenceApplyTo] = useState<"this" | "future" | "all">("this");
  const [editorBaseline, setEditorBaseline] = useState<string | null>(null);

  const editorStartIso = toIso(editorStartAt);
  const editorEndIso = toIso(editorEndAt) ?? editorStartIso;
  const recurrencePayload = editorRecurrenceEnabled
    ? {
        frequency: editorRecurrenceFreq,
        interval: Math.max(1, Number.parseInt(editorRecurrenceInterval || "1", 10)),
        daysOfWeek: editorRecurrenceFreq === "weekly" ? editorRecurrenceDays : undefined,
      }
    : undefined;

  const conflictingEvents = useMemo(() => {
    if (!editorStartIso || !editorEndIso) {
      return [] as Event[];
    }
    const nextStart = Date.parse(editorStartIso);
    const nextEnd = Date.parse(editorEndIso);
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd)) {
      return [] as Event[];
    }
    return sortedEvents.filter((item) => {
      if (item.id === editingEventId) return false;
      const start = Date.parse(item.start_at);
      const end = Date.parse(item.end_at ?? item.start_at);
      return nextStart < end && start < nextEnd;
    });
  }, [editorEndIso, editorStartIso, editingEventId, sortedEvents]);

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
    recurrenceEnabled: editorRecurrenceEnabled,
    recurrenceFreq: editorRecurrenceFreq,
    recurrenceInterval: editorRecurrenceInterval,
    recurrenceDays: editorRecurrenceDays,
    attachments: editorAttachments,
  });
  const isEditorDirty = editorOpen && editorBaseline !== null && editorCurrentSnapshot !== editorBaseline;
  useBeforeUnloadPrompt(isEditorDirty);

  const openCreateEditor = useCallback((initialDateKey?: string) => {
    const now = new Date();
    const fallbackStart = new Date(now.getTime() + 60 * 60_000);
    const dateStart = initialDateKey ? new Date(`${initialDateKey}T20:00:00`) : fallbackStart;
    const initialStartAt = toLocalInput(
      Number.isNaN(dateStart.getTime()) ? fallbackStart.toISOString() : dateStart.toISOString(),
    );
    const initialRecurrenceDays = [1, 3, 5];
    setEditorMode("create");
    setEditingEventId(null);
    setEditorType("guild_war");
    setEditorTitle("");
    setEditorDescription("");
    setEditorStartAt(initialStartAt);
    setEditorEndAt("");
    setEditorCapacity("");
    setEditorPinned(false);
    setEditorSignupLocked(false);
    setEditorRecurrenceEnabled(false);
    setEditorRecurrenceFreq("weekly");
    setEditorRecurrenceInterval("1");
    setEditorRecurrenceDays(initialRecurrenceDays);
    setEditorAttachments([]);
    setEditorRecurrenceApplyTo("this");
    setEditorBaseline(
      buildEditorSnapshot({
        mode: "create",
        editingEventId: null,
        type: "guild_war",
        title: "",
        description: "",
        startAt: initialStartAt,
        endAt: "",
        capacity: "",
        pinned: false,
        signupLocked: false,
        recurrenceEnabled: false,
        recurrenceFreq: "weekly",
        recurrenceInterval: "1",
        recurrenceDays: initialRecurrenceDays,
        attachments: [],
      }),
    );
    setEditorOpen(true);
  }, []);

  const openEditEditor = useCallback((event: Event) => {
    const recurrenceEnabled = Boolean(event.recurrence_rule);
    const recurrenceFreq = event.recurrence_rule?.frequency ?? "weekly";
    const recurrenceInterval = String(event.recurrence_rule?.interval ?? 1);
    const recurrenceDays = event.recurrence_rule?.daysOfWeek ?? [1, 3, 5];
    const startAt = toLocalInput(event.start_at);
    const endAt = toLocalInput(event.end_at);
    const capacity = event.capacity === null ? "" : String(event.capacity);

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
    setEditorRecurrenceEnabled(recurrenceEnabled);
    setEditorRecurrenceFreq(recurrenceFreq);
    setEditorRecurrenceInterval(recurrenceInterval);
    setEditorRecurrenceDays(recurrenceDays);
    setEditorAttachments(event.attachments ?? []);
    setEditorRecurrenceApplyTo("this");
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
        recurrenceEnabled,
        recurrenceFreq,
        recurrenceInterval,
        recurrenceDays,
        attachments: event.attachments ?? [],
      }),
    );
    setEditorOpen(true);
  }, []);

  const closeEditor = useCallback(async () => {
    if (isEditorDirty) {
      const confirmed = await new Promise<boolean>((resolve) => {
        modals.openConfirmModal({
          title: t("confirm.discardUnsaved.title"),
          children: t("confirm.discardUnsaved.description"),
          confirmProps: { color: "infini-warning" },
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
          closeOnConfirm: true,
          closeOnCancel: true,
          centered: true,
        });
      });
      if (!confirmed) {
        return false;
      }
    }
    setEditorOpen(false);
    setEditorBaseline(null);
    return true;
  }, [isEditorDirty, t]);
  const closeEditorAfterSave = useCallback(() => {
    setEditorOpen(false);
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
    editorRecurrenceEnabled,
    editorRecurrenceFreq,
    editorRecurrenceInterval,
    editorRecurrenceDays,
    editorAttachments,
    editorRecurrenceApplyTo,
    editorStartIso,
    editorEndIso,
    recurrencePayload,
    conflictingEvents,
    isEditorDirty,
    setEditorType,
    setEditorTitle,
    setEditorDescription,
    setEditorStartAt,
    setEditorEndAt,
    setEditorCapacity,
    setEditorPinned,
    setEditorSignupLocked,
    setEditorRecurrenceEnabled,
    setEditorRecurrenceFreq,
    setEditorRecurrenceInterval,
    setEditorRecurrenceDays,
    setEditorAttachments,
    setEditorRecurrenceApplyTo,
    openCreateEditor,
    openEditEditor,
    closeEditor,
    closeEditorAfterSave,
  };
}
