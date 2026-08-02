import type { MemberProfile } from "@guild/shared";
import { isAllowedVideoUrl } from "@guild/shared/utils/video";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppError } from "./useAppError";
import { notifyWarning } from "../utils/notifications";
import { buildClassOptions, useClassCatalogStore } from "../stores/class-catalog";

type UseProfileFormStateParams = {
  profile: MemberProfile | null | undefined;
};

/** 一次提交里会送出去的那几项草稿；acceptServerProfile 拿它判断哪些字段还没被改过。 */
export type ProfileDraftSnapshot = {
  bio: string;
  titleHtml: string;
  power: number;
  classList: string[];
  videoList: string[];
  imageList: string[];
  availabilityData: Record<string, unknown> | null;
};

type ProfileDraftBaseline = ProfileDraftSnapshot & { identity: string };

function buildProfileDraftBaseline(profile: MemberProfile): ProfileDraftBaseline {
  return {
    identity: `${profile.user_id}:${profile.id}`,
    bio: profile.bio ?? "",
    titleHtml: profile.title_html ?? "",
    power: profile.power,
    classList: [...profile.classes],
    videoList: [...profile.video_urls],
    imageList: [...profile.images],
    availabilityData: (profile.availability ?? null) as Record<string, unknown> | null,
  };
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const AVAILABILITY_DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

/**
 * 把可用时间压成一个只反映「哪几天、几点到几点」的字符串，用来判断有没有改动。
 *
 * 直接 JSON.stringify 比较，等于把键的顺序和空数组写不写出来也算成改动。最容易
 * 撞上的一种：从没填过时后端存的是 null，用户加一段时间再删掉，编辑器交回来的是
 * 七个空数组——语义上和 null 一模一样，字符串却不同，于是「有未保存更改」一直
 * 亮着，除非刷新页面，否则消不掉。
 *
 * 时区只在真有时段的时候才计入：一段时间都没有的时候，时区不描述任何东西。
 */
function canonicalAvailability(value: Record<string, unknown> | null): string {
  if (!value || typeof value !== "object") return "";
  const raw = value.days;
  if (!raw || typeof raw !== "object") return "";
  const days = raw as Record<string, unknown>;

  const parts: string[] = [];
  for (const day of AVAILABILITY_DAY_KEYS) {
    const list = days[day];
    if (!Array.isArray(list)) continue;
    const blocks: string[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (typeof row.start_utc !== "string" || typeof row.end_utc !== "string") continue;
      blocks.push(`${row.start_utc}-${row.end_utc}`);
    }
    if (blocks.length > 0) parts.push(`${day}:${blocks.join(",")}`);
  }

  if (parts.length === 0) return "";
  const timezone = typeof value.timezone === "string" ? value.timezone : "";
  return `${timezone}|${parts.join("|")}`;
}

function reconcileProfileImages(
  draft: string[],
  previousBaseline: string[],
  nextBaseline: string[],
): string[] {
  if (stringArraysEqual(draft, previousBaseline)) {
    return [...nextBaseline];
  }

  const serverKeys = new Set(nextBaseline);
  const preservedDraft = draft.filter((key) => serverKeys.has(key));
  const preservedKeys = new Set(preservedDraft);
  return [
    ...preservedDraft,
    ...nextBaseline.filter((key) => !preservedKeys.has(key)),
  ];
}

export type ProfileFormStateController = ReturnType<typeof useProfileFormState>;

export function useProfileFormState({ profile }: UseProfileFormStateParams) {
  const { t } = useTranslation("profile");
  const { showError } = useAppError();
  const classCatalog = useClassCatalogStore((state) => state.items);

  const initialBaseline = useRef(profile ? buildProfileDraftBaseline(profile) : null).current;
  const [baseline, setBaseline] = useState<ProfileDraftBaseline | null>(initialBaseline);
  const baselineRef = useRef<ProfileDraftBaseline | null>(initialBaseline);
  const [bio, setBio] = useState(initialBaseline?.bio ?? "");
  const [titleHtml, setTitleHtml] = useState(initialBaseline?.titleHtml ?? "");
  const [power, setPower] = useState(initialBaseline?.power ?? 0);
  const [classDraft, setClassDraft] = useState("");
  const [classList, setClassList] = useState<string[]>(
    initialBaseline?.classList ?? [],
  );
  const [videoDraft, setVideoDraft] = useState("");
  const [videoList, setVideoList] = useState<string[]>(initialBaseline?.videoList ?? []);
  const [imageList, setImageList] = useState<string[]>(initialBaseline?.imageList ?? []);
  const [availabilityData, setAvailabilityData] = useState<Record<string, unknown> | null>(
    initialBaseline?.availabilityData ?? null,
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [currentPasswordForUsername, setCurrentPasswordForUsername] = useState("");
  const [newUsername, setNewUsername] = useState("");

  useEffect(() => {
    if (!profile) {
      return;
    }

    const nextBaseline = buildProfileDraftBaseline(profile);
    const previousBaseline = baselineRef.current;

    if (!previousBaseline || previousBaseline.identity !== nextBaseline.identity) {
      setBio(nextBaseline.bio);
      setTitleHtml(nextBaseline.titleHtml);
      setPower(nextBaseline.power);
      setClassList(nextBaseline.classList);
      setVideoList(nextBaseline.videoList);
      setImageList(nextBaseline.imageList);
      setAvailabilityData(nextBaseline.availabilityData);
    } else {
      setImageList((current) =>
        reconcileProfileImages(
          current,
          previousBaseline.imageList,
          nextBaseline.imageList,
        ),
      );
    }

    baselineRef.current = nextBaseline;
    setBaseline(nextBaseline);
  }, [profile]);

  /**
   * 保存成功后校准基线；`submitted` 是这次提交出去的那份草稿快照。
   *
   * 只挪基线是不够的：服务端在写入时会规范化字段——称号 HTML 要过一遍白名单
   * 清洗（sanitizeTitleHtml 只留 span/b/strong/i/em/u/br），沙盒的「手写 HTML」
   * 里放一个 <div> 或 <p> 就会被削掉。于是存完之后草稿仍是提交前那一份、基线
   * 已经是清洗后的那一份，isDirty 永远为真：右下角的「未保存更改」撤不掉，
   * 再点保存也只是把同一次写入重复一遍。
   *
   * 但也不能无条件覆盖草稿——请求在飞的那几百毫秒里用户可能又改了一笔，那一笔
   * 必须留住。所以只校准「提交之后没再动过」的字段：草稿仍等于提交值的，换成
   * 服务端规范化后的结果；已经不等的，原样保留。
   * 不传 submitted 时只挪基线，语义和从前一致。
   */
  const acceptServerProfile = useCallback((
    serverProfile: MemberProfile,
    submitted?: ProfileDraftSnapshot,
  ) => {
    const nextBaseline = buildProfileDraftBaseline(serverProfile);
    baselineRef.current = nextBaseline;
    setBaseline(nextBaseline);
    if (!submitted) return;

    setBio((current) => (current === submitted.bio ? nextBaseline.bio : current));
    setTitleHtml((current) => (current === submitted.titleHtml ? nextBaseline.titleHtml : current));
    setPower((current) => (current === submitted.power ? nextBaseline.power : current));
    setClassList((current) => (
      stringArraysEqual(current, submitted.classList) ? nextBaseline.classList : current
    ));
    setVideoList((current) => (
      stringArraysEqual(current, submitted.videoList) ? nextBaseline.videoList : current
    ));
    setImageList((current) => (
      stringArraysEqual(current, submitted.imageList) ? nextBaseline.imageList : current
    ));
    setAvailabilityData((current) => (
      canonicalAvailability(current) === canonicalAvailability(submitted.availabilityData)
        ? nextBaseline.availabilityData
        : current
    ));
  }, []);

  const classOptions = useMemo(
    () => buildClassOptions(classCatalog, classList),
    [classCatalog, classList],
  );

  const activeNowEstimate = useMemo(() => {
    const dayKeys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
    const now = new Date();
    const dayKey = dayKeys[now.getUTCDay()]!;
    const days =
      availabilityData && typeof availabilityData === "object" && "days" in availabilityData
        ? (availabilityData as Record<string, unknown>).days
        : null;
    const raw = days && typeof days === "object" ? (days as Record<string, unknown>)[dayKey] : null;
    if (!Array.isArray(raw)) {
      return t("availability.none");
    }

    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    let minutesUntilNext = Number.POSITIVE_INFINITY;
    for (const item of raw) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const startUtc = (item as Record<string, unknown>).start_utc;
      const endUtc = (item as Record<string, unknown>).end_utc;
      if (typeof startUtc !== "string" || typeof endUtc !== "string") {
        continue;
      }
      const startParts = startUtc.split(":").map((value) => Number.parseInt(value, 10));
      const endParts = endUtc.split(":").map((value) => Number.parseInt(value, 10));
      const startHour = startParts[0];
      const startMinute = startParts[1];
      const endHour = endParts[0];
      const endMinute = endParts[1];
      if (
        startHour === undefined || startMinute === undefined ||
        endHour === undefined || endMinute === undefined ||
        !Number.isFinite(startHour) || !Number.isFinite(startMinute) ||
        !Number.isFinite(endHour) || !Number.isFinite(endMinute)
      ) {
        continue;
      }
      const startTotal = startHour * 60 + startMinute;
      const endTotal = endHour * 60 + endMinute;
      if (currentMinutes >= startTotal && currentMinutes < endTotal) {
        return t("availability.activeNow");
      }
      if (startTotal > currentMinutes) {
        minutesUntilNext = Math.min(minutesUntilNext, startTotal - currentMinutes);
      }
    }
    if (Number.isFinite(minutesUntilNext)) {
      return t("availability.nextWindowMinutes", { minutes: Math.max(1, Math.round(minutesUntilNext)) });
    }
    return t("availability.noneToday");
  }, [availabilityData, t]);

  /**
   * `value` 让调用点把刚选中的那一项直接传进来。选择器现在是「选中即添加」，
   * 而 setClassDraft 是异步的——同一次事件里先 set 再无参调用，读到的还是上一
   * 个 draft，会添加错的那一项。
   */
  const addClass = (value?: string) => {
    const next = (value ?? classDraft).trim().toLowerCase();
    if (!next) {
      return;
    }

    const normalized = classOptions.find((option) =>
      option.value.toLowerCase() === next || option.label.toLowerCase() === next
    )?.value;
    if (!normalized) {
      notifyWarning(t("message.classInvalid"));
      return;
    }
    if (classList.includes(normalized)) {
      notifyWarning(t("message.classDuplicate"));
      return;
    }

    setClassList((current) => [...current, normalized]);
    setClassDraft("");
  };

  const addVideoUrl = () => {
    const next = videoDraft.trim();
    if (!next) {
      return;
    }
    if (!isAllowedVideoUrl(next)) {
      showError(new Error(t("message.videoHostUnsupported")), t("message.videoHostAllowedOnly"));
      return;
    }
    if (videoList.includes(next)) {
      notifyWarning(t("message.videoUrlDuplicate"));
      return;
    }
    if (videoList.length >= 10) {
      notifyWarning(t("message.videoUrlLimit"));
      return;
    }

    setVideoList((current) => [...current, next]);
    setVideoDraft("");
  };

  const handleClassDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    setClassList((current) => {
      const activeId = String(active.id);
      const overId = String(over.id);
      const oldIndex = current.indexOf(activeId);
      const newIndex = current.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) {
        return current;
      }
      return arrayMove(current, oldIndex, newIndex);
    });
  };

  const removeClass = (index: number) => {
    setClassList((current) => current.filter((_, valueIndex) => valueIndex !== index));
  };

  /**
   * Dirtiness split by the screen that owns the fields, so a tab can show its
   * own unsaved marker. A single global flag told you the page had changes but
   * not which tab they were on — after switching away, the only way to find
   * them was to visit every tab.
   */
  const dirtySections = useMemo(() => {
    if (!baseline) return { home: false, availability: false };
    return {
      home:
        bio !== baseline.bio ||
        titleHtml !== baseline.titleHtml ||
        power !== baseline.power ||
        JSON.stringify(classList) !== JSON.stringify(baseline.classList) ||
        JSON.stringify(videoList) !== JSON.stringify(baseline.videoList) ||
        JSON.stringify(imageList) !== JSON.stringify(baseline.imageList),
      availability:
        canonicalAvailability(availabilityData) !== canonicalAvailability(baseline.availabilityData),
    };
  }, [
    availabilityData,
    baseline,
    bio,
    classList,
    imageList,
    power,
    titleHtml,
    videoList,
  ]);

  const isDirty = dirtySections.home || dirtySections.availability;

  return {
    bio,
    setBio,
    titleHtml,
    setTitleHtml,
    power,
    setPower,
    classDraft,
    setClassDraft,
    classList,
    setClassList,
    videoDraft,
    setVideoDraft,
    videoList,
    setVideoList,
    imageList,
    setImageList,
    availabilityData,
    setAvailabilityData,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmNewPassword,
    setConfirmNewPassword,
    currentPasswordForUsername,
    setCurrentPasswordForUsername,
    newUsername,
    setNewUsername,
    classOptions,
    activeNowEstimate,
    dirtySections,
    isDirty,
    acceptServerProfile,
    addClass,
    removeClass,
    addVideoUrl,
    handleClassDragEnd,
  };
}
