import type { RequestContext } from "@guild/kernel";
import { PERMISSION_ID } from "@guild/shared/constants/roles";

export type ContentReadScope =
  | Readonly<{ kind: "public" }>
  | Readonly<{ kind: "owned"; ownerUserId: string }>
  | Readonly<{ kind: "all" }>;

export type ContentReadScopes = Readonly<{
  announcement: ContentReadScope;
  wikiArticle: ContentReadScope;
}>;

const PUBLIC_SCOPE = { kind: "public" } as const;
const ALL_SCOPE = { kind: "all" } as const;

export function contentReadScopes(context: RequestContext): ContentReadScopes {
  return {
    announcement: resolveScope(
      context,
      PERMISSION_ID.ANNOUNCEMENTS_CREATE,
      [
        PERMISSION_ID.ANNOUNCEMENTS_EDIT,
        PERMISSION_ID.ANNOUNCEMENTS_ARCHIVE,
        PERMISSION_ID.ANNOUNCEMENTS_DELETE,
      ],
    ),
    wikiArticle: resolveScope(
      context,
      PERMISSION_ID.WIKI_ARTICLES_CREATE,
      [
        PERMISSION_ID.WIKI_ARTICLES_EDIT,
        PERMISSION_ID.WIKI_ARTICLES_ARCHIVE,
        PERMISSION_ID.WIKI_ARTICLES_DELETE,
      ],
    ),
  };
}

function resolveScope(
  context: RequestContext,
  createPermission: string,
  managePermissions: readonly string[],
): ContentReadScope {
  if (managePermissions.some((permission) => context.authorization.has(permission))) return ALL_SCOPE;
  const actor = context.authorization.actor;
  if (actor && context.authorization.has(createPermission)) {
    return { kind: "owned", ownerUserId: actor.userId };
  }
  return PUBLIC_SCOPE;
}
