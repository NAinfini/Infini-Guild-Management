import { AppError, type RequestContext } from "@guild/kernel";
import { eventViewer, projectEventForViewer } from "@guild/server/modules/events";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { LIMITS } from "@guild/shared/config/limits";
import type {
  DashboardEventsViewerRead,
  PortalReadModelStore,
  RuntimeHealthPort,
} from "./model.js";
import { assertPortableLikeSearch } from "../../portable-search.js";

const SEARCH_DEFAULT_LIMIT = 24;
const SEARCH_MAX_LIMIT = LIMITS.pagination.search;
const SEARCH_MIN_LENGTH = 2;
const SEARCH_MAX_LENGTH = 80;
const DASHBOARD_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

export class PortalReadModelService {
  constructor(private readonly store: PortalReadModelStore) {}

  dashboardMembers(_context: RequestContext) {
    return this.store.dashboardMembers();
  }

  async dashboardEvents(
    context: RequestContext,
    externalView: boolean,
  ): Promise<DashboardEventsViewerRead> {
    const viewer = eventViewer(context, externalView);
    const result = await this.store.dashboardEvents({
      now: context.now,
      windowEnd: new Date(Date.parse(context.now) + DASHBOARD_WINDOW_MS).toISOString(),
      viewerUserId: viewer.userId,
      canViewHidden: viewer.canEdit,
    });
    return {
      ...result,
      featuredEvents: result.featuredEvents.map((item) => ({
        ...item,
        aggregate: projectEventForViewer(item.aggregate, viewer),
      })),
      upcomingEvents: result.upcomingEvents.map((item) => ({
        ...item,
        aggregate: projectEventForViewer(item.aggregate, viewer),
      })),
    };
  }

  async dashboardWars(context: RequestContext, externalView = false) {
    const result = await this.store.dashboardWars();
    if (context.authorization.isAuthenticated() && !externalView) return result;
    return {
      allWarWinRate: result.allWarWinRate,
      recentWars: result.recentWars.map((war) => ({
        id: war.id,
        eventId: war.eventId,
        warName: war.warName,
        enemyName: war.enemyName,
        result: war.result,
        ownStats: war.ownStats,
        enemyStats: war.enemyStats,
        durationMinutes: war.durationMinutes,
        createdAt: war.createdAt,
        updatedAt: war.updatedAt,
      })),
    };
  }

  async search(
    context: RequestContext,
    queryInput: string,
    limitInput = SEARCH_DEFAULT_LIMIT,
  ) {
    const query = queryInput.normalize("NFKC").trim();
    if (query.length < SEARCH_MIN_LENGTH) return [];
    if (query.length > SEARCH_MAX_LENGTH) throw validation("Search query is too long");
    assertPortableLikeSearch(query.toLowerCase());
    if (!Number.isInteger(limitInput) || limitInput < 1 || limitInput > SEARCH_MAX_LIMIT) {
      throw validation(`Search limit must be between 1 and ${SEARCH_MAX_LIMIT}`);
    }
    return this.store.search({
      query,
      limit: limitInput,
      perTypeLimit: Math.max(3, Math.ceil(limitInput / 3)),
      now: context.now,
    });
  }
}

export class AdminStatusService {
  constructor(private readonly health: RuntimeHealthPort) {}

  async status(context: RequestContext) {
    context.authorization.require(PERMISSION_ID.ADMIN_STATUS_VIEW);
    return this.health.read(context);
  }
}

function validation(message: string): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message });
}
