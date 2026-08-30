export {
  fetchDashboardEvents,
  fetchDashboardWars,
} from "../api/queries/dashboard";
import { queryKeys } from "../api/query-keys";

export const dashboardQueryKeys = queryKeys.dashboard;
export type {
  DashboardEvent,
  DashboardEventsResponse,
  DashboardParticipant,
  DashboardWarMvp,
  DashboardWarsResponse,
} from "../api/queries/dashboard";
