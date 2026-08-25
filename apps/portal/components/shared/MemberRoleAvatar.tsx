import { BoltIcon } from "@portal/components/icons";
import { Avatar, AvatarFallback, AvatarImage } from "@portal/components/ui/avatar";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@portal/components/ui/preview-card";
import { resolveMediaUrl } from "../../utils/media";
import { useClassCatalog } from "../../hooks/data/useClassData";
import { resolveClassCatalogItem } from "../../utils/class-catalog";
import { ClassIcon } from "./ClassIcon";
import "./MemberCard.css";

function getUniqueClassIds(classes: readonly string[]): string[] {
  return [...new Set(classes.filter(Boolean))];
}

type MemberRoleAvatarProps = {
  user: {
    display_name: string;
  };
  profile: {
    classes: readonly string[];
    power: number;
    avatar_media_id: string | null;
  };
  size?: number;
  withTooltip?: boolean;
  /*
   * 头像右下角那一圈职业图标。花名册要它——那里一个人就是一行，图标是主要信息。
   * 活动卡不要：卡片已经用职业配额筹码在讲「缺什么职业」，每个头像再挂三个小圈
   * 就是同一件事说两遍，而且头像本身要叠在一起，圈圈会互相压。
   */
  withClassCircles?: boolean;
};

export function MemberRoleAvatar({
  user,
  profile,
  size = 36,
  withTooltip = true,
  withClassCircles = true,
}: MemberRoleAvatarProps) {
  const catalog = useClassCatalog();
  const classItems = getUniqueClassIds(profile.classes).map((id) =>
    resolveClassCatalogItem(id, catalog)
  );
  const visibleClassItems = classItems.slice(0, 3);
  const hiddenCount = Math.max(0, classItems.length - visibleClassItems.length);
  const avatarSrc = profile.avatar_media_id ? resolveMediaUrl(profile.avatar_media_id) : undefined;
  const circleSize = Math.max(18, Math.min(24, Math.round(size * 0.52)));

  const avatar = (
    <div className="member-role-avatar">
      <Avatar style={{ width: size, height: size }}>
        {avatarSrc ? <AvatarImage src={avatarSrc} alt="" /> : null}
        <AvatarFallback>{user.display_name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      {withClassCircles && visibleClassItems.length > 0 ? (
        <div className="member-role-avatar__roles" aria-hidden="true">
          {hiddenCount > 0 ? (
            <span
              className="member-role-avatar__overflow"
              style={{ width: circleSize, height: circleSize }}
            >
              +{hiddenCount}
            </span>
          ) : null}
          {visibleClassItems.map((item) => (
            <ClassIcon
              key={item.id}
              item={item}
              size={circleSize}
              className="member-role-avatar__role-circle"
            />
          ))}
        </div>
      ) : null}
    </div>
  );

  if (!withTooltip) return avatar;

  return (
    <PreviewCard>
      <PreviewCardTrigger
        delay={200}
        closeDelay={100}
        render={<button type="button" className="member-role-avatar__trigger" aria-label={user.display_name} />}
      >
        {avatar}
      </PreviewCardTrigger>
      <PreviewCardContent side="top" className="member-role-avatar__popover">
        <div className="member-role-avatar__summary">
          <Avatar size="lg">
            {avatarSrc ? <AvatarImage src={avatarSrc} alt="" /> : null}
            <AvatarFallback>{user.display_name.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="member-role-avatar__identity">
            <strong className="member-role-avatar__name">{user.display_name}</strong>
            {classItems.length > 0 ? (
              <span className="member-role-avatar__classes">
                {classItems.map((item) => item.label).join(" · ")}
              </span>
            ) : null}
          </div>
        </div>
        <div className="member-role-avatar__details">
          {classItems.map((item) => (
            <span key={item.id} className="member-role-avatar__class-detail">
              <ClassIcon item={item} size={20} />
              <span>{item.label}</span>
            </span>
          ))}
          {profile.power > 0 ? (
            <span className="member-role-avatar__power">
              <BoltIcon size={13} className="member-role-avatar__power-icon" />{" "}
              {profile.power.toLocaleString()}
            </span>
          ) : null}
        </div>
      </PreviewCardContent>
    </PreviewCard>
  );
}

export { getUniqueClassIds };
