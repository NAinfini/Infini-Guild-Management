export { fetchDashboardSummary } from "../api/queries/dashboard";
export { queryKeys as dashboardServiceQueryKeys } from "../api/query-keys";
import { queryKeys } from "../api/query-keys";

export const dashboardQueryKeys = queryKeys.dashboard;
export type {
  DashboardSummaryEvent,
  DashboardSummaryParticipant,
  DashboardSummaryResponse,
  DashboardSummaryWarMvp,
} from "../api/queries/dashboard";
