export { fetchDashboardSummary } from "../api/queries/dashboard";
import { queryKeys } from "../api/query-keys";

export const dashboardQueryKeys = queryKeys.dashboard;
export type {
  DashboardSummaryEvent,
  DashboardSummaryParticipant,
  DashboardSummaryResponse,
  DashboardSummaryWarMvp,
} from "../api/queries/dashboard";
