import { subDays } from "date-fns";
import { localDateKey } from "../utils/datetime";
import { useReducer } from "react";

export type AuditDatePreset = "1d" | "7d" | "1m";

/* 预设和天数的唯一对照表：正着用来算日期，反着用来认出手上这对日期出自哪个预设。
   两个方向共用它，工具条上高亮的那一格才不可能和实际过滤的区间对不上。 */
const PRESET_DAYS: Record<AuditDatePreset, number> = { "1d": 1, "7d": 7, "1m": 30 };

export function auditDateRangeFor(preset: AuditDatePreset, today = new Date()) {
  return {
    from: localDateKey(subDays(today, PRESET_DAYS[preset])),
    to: localDateKey(today),
  };
}

/** 认不出来（含空区间、跨过零点的旧区间）就是自定义。 */
export function matchAuditDatePreset(from: string, to: string): AuditDatePreset | null {
  const today = new Date();
  const presets = Object.keys(PRESET_DAYS) as AuditDatePreset[];
  return presets.find((preset) => {
    const range = auditDateRangeFor(preset, today);
    return range.from === from && range.to === to;
  }) ?? null;
}

export type AuditFilterState = {
  search: string;
  dateFrom: string;
  dateTo: string;
  entityType: string;
  entityId: string;
  actorId: string;
};

type AuditFilterAction =
  | { type: "SET_SEARCH"; value: string }
  | { type: "SET_DATE_FROM"; value: string }
  | { type: "SET_DATE_TO"; value: string }
  | { type: "SET_DATE_RANGE"; from: string; to: string }
  | { type: "SET_ENTITY_TYPE"; value: string }
  | { type: "SET_ENTITY_TARGET"; entityType: string; entityId: string }
  | { type: "CLEAR_ENTITY_TARGET" }
  | { type: "SET_ACTOR_ID"; value: string };

function auditFilterReducer(state: AuditFilterState, action: AuditFilterAction): AuditFilterState {
  switch (action.type) {
    case "SET_SEARCH": return { ...state, search: action.value };
    case "SET_DATE_FROM": return { ...state, dateFrom: action.value };
    case "SET_DATE_TO": return { ...state, dateTo: action.value };
    case "SET_DATE_RANGE": return { ...state, dateFrom: action.from, dateTo: action.to };
    case "SET_ENTITY_TYPE": return { ...state, entityType: action.value, entityId: "" };
    case "SET_ENTITY_TARGET": return { ...state, entityType: action.entityType, entityId: action.entityId };
    case "CLEAR_ENTITY_TARGET": return { ...state, entityType: "", entityId: "" };
    case "SET_ACTOR_ID": return { ...state, actorId: action.value };
  }
}

export function useAdminAuditFilter() {
  /* 七天兼顾近期排障和趋势回看，同时避免默认查询整本审计日志。 */
  const [auditFilter, dispatch] = useReducer(auditFilterReducer, undefined, () => {
    const initial = auditDateRangeFor("7d");
    return {
      search: "",
      dateFrom: initial.from,
      dateTo: initial.to,
      entityType: "",
      entityId: "",
      actorId: "",
    };
  });

  const setAuditDatePreset = (preset: AuditDatePreset) => {
    const range = auditDateRangeFor(preset);
    dispatch({ type: "SET_DATE_RANGE", from: range.from, to: range.to });
  };

  return {
    auditFilter,
    setAuditSearch: (value: string) => dispatch({ type: "SET_SEARCH", value }),
    setAuditDateFrom: (value: string) => dispatch({ type: "SET_DATE_FROM", value }),
    setAuditDateTo: (value: string) => dispatch({ type: "SET_DATE_TO", value }),
    setAuditDateRange: (from: string, to: string) =>
      dispatch({ type: "SET_DATE_RANGE", from, to }),
    setAuditDatePreset,
    setAuditEntityType: (value: string) => dispatch({ type: "SET_ENTITY_TYPE", value }),
    setAuditEntityTarget: (entityType: string, entityId: string) =>
      dispatch({ type: "SET_ENTITY_TARGET", entityType, entityId }),
    clearAuditEntityTarget: () => dispatch({ type: "CLEAR_ENTITY_TARGET" }),
    setAuditActorId: (value: string) => dispatch({ type: "SET_ACTOR_ID", value }),
  };
}
