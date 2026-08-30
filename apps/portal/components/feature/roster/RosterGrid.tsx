import type { MemberProfile, User, UserBadge } from "@guild/shared";
import type { FocusEvent, PointerEvent } from "react";
import { MemberCard } from "../../shared/MemberCard";
import { resolveMediaUrl } from "../../../utils/media";

type RosterEntry = { user: User; profile: MemberProfile; badges?: UserBadge[] };

type Props = {
  rows: RosterEntry[];
  ariaLabel: string;
  onCardClick: (entry: RosterEntry) => void;
  onCardMouseEnter: (entry: RosterEntry) => void;
  onCardMouseLeave: () => void;
  onCardFocus: (entry: RosterEntry) => void;
  onCardBlur: (event: FocusEvent<HTMLDivElement>) => void;
};

export function RosterGrid({
  rows,
  ariaLabel,
  onCardClick,
  onCardMouseEnter,
  onCardMouseLeave,
  onCardFocus,
  onCardBlur,
}: Props) {
  const handlePointerEnter = (event: PointerEvent<HTMLDivElement>, entry: RosterEntry) => {
    if (event.pointerType === "mouse") onCardMouseEnter(entry);
  };
  const handlePointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") onCardMouseLeave();
  };

  return (
    <div className="roster-grid-region" role="list" aria-label={ariaLabel}>
      <div className="roster-card-grid">
        {rows.map((entry) => (
          <div key={entry.user.id} role="listitem" className="roster-card-cell">
            <div
              className="roster-card-interaction"
              onPointerEnter={(event) => handlePointerEnter(event, entry)}
              onPointerLeave={handlePointerLeave}
              onFocus={() => onCardFocus(entry)}
              onBlur={onCardBlur}
            >
              <MemberCard
                user={entry.user}
                profile={entry.profile}
                badges={entry.badges}
                resolveMediaUrl={resolveMediaUrl}
                onClick={() => onCardClick(entry)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
