import { format, subDays } from "date-fns";
import { useReducer } from "react";

export type AuditFilterState = {
  page: number;
  search: string;
  dateFrom: string;
  dateTo: string;
};

type AuditFilterAction =
  | { type: "SET_PAGE"; value: number }
  | { type: "SET_SEARCH"; value: string }
  | { type: "SET_DATE_FROM"; value: string }
  | { type: "SET_DATE_TO"; value: string }
  | { type: "SET_DATE_RANGE"; from: string; to: string; page: number };

function auditFilterReducer(state: AuditFilterState, action: AuditFilterAction): AuditFilterState {
  switch (action.type) {
    case "SET_PAGE": return { ...state, page: action.value };
    case "SET_SEARCH": return { ...state, search: action.value };
    case "SET_DATE_FROM": return { ...state, dateFrom: action.value };
    case "SET_DATE_TO": return { ...state, dateTo: action.value };
    case "SET_DATE_RANGE": return { ...state, dateFrom: action.from, dateTo: action.to, page: action.page };
  }
}

export function useAdminAuditFilter() {
  const [auditFilter, dispatch] = useReducer(auditFilterReducer, undefined, () => ({
    page: 1,
    search: "",
    dateFrom: format(subDays(new Date(), 1), "yyyy-MM-dd"),
    dateTo: format(new Date(), "yyyy-MM-dd"),
  }));

  const setAuditDatePreset = (preset: "1d" | "7d" | "1m") => {
    const today = new Date();
    const days = preset === "1d" ? 1 : preset === "7d" ? 7 : 30;
    dispatch({
      type: "SET_DATE_RANGE",
      from: format(subDays(today, days), "yyyy-MM-dd"),
      to: format(today, "yyyy-MM-dd"),
      page: 1,
    });
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
  };
}
