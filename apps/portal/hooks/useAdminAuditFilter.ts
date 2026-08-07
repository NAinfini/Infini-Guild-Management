import { format, subDays } from "date-fns";
import { useReducer } from "react";

export type AuditDatePreset = "1d" | "7d" | "1m";

/* 预设和天数的唯一对照表：正着用来算日期，反着用来认出手上这对日期出自哪个预设。
   两个方向共用它，工具条上高亮的那一格才不可能和实际过滤的区间对不上。 */
const PRESET_DAYS: Record<AuditDatePreset, number> = { "1d": 1, "7d": 7, "1m": 30 };

export function auditDateRangeFor(preset: AuditDatePreset, today = new Date()) {
  return {
    from: format(subDays(today, PRESET_DAYS[preset]), "yyyy-MM-dd"),
    to: format(today, "yyyy-MM-dd"),
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
  page: number;
  search: string;
  dateFrom: string;
  dateTo: string;
  entityType: string;
  actorId: string;
};

type AuditFilterAction =
  | { type: "SET_PAGE"; value: number }
  | { type: "SET_SEARCH"; value: string }
  | { type: "SET_DATE_FROM"; value: string }
  | { type: "SET_DATE_TO"; value: string }
  | { type: "SET_DATE_RANGE"; from: string; to: string; page: number }
  | { type: "SET_ENTITY_TYPE"; value: string }
  | { type: "SET_ACTOR_ID"; value: string };

function auditFilterReducer(state: AuditFilterState, action: AuditFilterAction): AuditFilterState {
  switch (action.type) {
    case "SET_PAGE": return { ...state, page: action.value };
    case "SET_SEARCH": return { ...state, search: action.value };
    case "SET_DATE_FROM": return { ...state, dateFrom: action.value };
    case "SET_DATE_TO": return { ...state, dateTo: action.value };
    case "SET_DATE_RANGE": return { ...state, dateFrom: action.from, dateTo: action.to, page: action.page };
    case "SET_ENTITY_TYPE": return { ...state, entityType: action.value, page: 1 };
    case "SET_ACTOR_ID": return { ...state, actorId: action.value, page: 1 };
  }
}

export function useAdminAuditFilter() {
  /* 进页面就落在最近一天：审计日志按时间倒序，不设区间等于把整本翻出来。 */
  const [auditFilter, dispatch] = useReducer(auditFilterReducer, undefined, () => {
    const initial = auditDateRangeFor("1d");
    return {
      page: 1,
      search: "",
      dateFrom: initial.from,
      dateTo: initial.to,
      entityType: "",
      actorId: "",
    };
  });

  const setAuditDatePreset = (preset: AuditDatePreset) => {
    const range = auditDateRangeFor(preset);
    dispatch({ type: "SET_DATE_RANGE", from: range.from, to: range.to, page: 1 });
  };

  return {
    auditFilter,
    setAuditPage: (value: number) => dispatch({ type: "SET_PAGE", value }),
    setAuditSearch: (value: string) => dispatch({ type: "SET_SEARCH", value }),
    setAuditDateFrom: (value: string) => dispatch({ type: "SET_DATE_FROM", value }),
    setAuditDateTo: (value: string) => dispatch({ type: "SET_DATE_TO", value }),
    setAuditDateRange: (from: string, to: string, page = 1) =>
      dispatch({ type: "SET_DATE_RANGE", from, to, page }),
    setAuditDatePreset,
    setAuditEntityType: (value: string) => dispatch({ type: "SET_ENTITY_TYPE", value }),
    setAuditActorId: (value: string) => dispatch({ type: "SET_ACTOR_ID", value }),
  };
}
