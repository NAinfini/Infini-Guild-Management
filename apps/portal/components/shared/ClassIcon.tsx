import type { ClassCatalogItem, ClassVectorIconId } from "@guild/shared";
import {
  BoltIcon,
  BookTextIcon,
  BootIcon,
  CloudIcon,
  CrownIcon,
  DiceFiveFilledIcon,
  FlagIcon,
  FlameIcon,
  FriendsIcon,
  GauntletIcon,
  GiftIcon,
  HammerIcon,
  HeartIcon,
  HeartbeatIcon,
  MoonIcon,
  PaletteIcon,
  PendantIcon,
  RingsIcon,
  ShieldIcon,
  Sparkles2Icon,
  SparklesIcon,
  SunIcon,
  SwordIcon,
  SwordsIcon,
  TargetArrowIcon,
  TargetIcon,
  TrophyIcon,
  UserCircleIcon,
  UserIcon,
  UsersIcon,
  WorldIcon,
  WrenchIcon,
  ZapIcon,
} from "@portal/components/icons";
import { useState, type ComponentType, type CSSProperties, type HTMLAttributes } from "react";
import { resolveClassIconUrl } from "../../stores/class-catalog";
import "./ClassIcon.css";

type VectorIconComponent = ComponentType<HTMLAttributes<HTMLDivElement> & { size?: number }>;

export const CLASS_VECTOR_ICON_COMPONENTS: Record<ClassVectorIconId, VectorIconComponent> = {
  sword: SwordIcon,
  swords: SwordsIcon,
  shield: ShieldIcon,
  heartbeat: HeartbeatIcon,
  heart: HeartIcon,
  bolt: BoltIcon,
  zap: ZapIcon,
  flame: FlameIcon,
  target: TargetIcon,
  "target-arrow": TargetArrowIcon,
  crown: CrownIcon,
  trophy: TrophyIcon,
  hammer: HammerIcon,
  gauntlet: GauntletIcon,
  boot: BootIcon,
  pendant: PendantIcon,
  rings: RingsIcon,
  sparkles: SparklesIcon,
  "sparkles-2": Sparkles2Icon,
  user: UserIcon,
  users: UsersIcon,
  "user-circle": UserCircleIcon,
  friends: FriendsIcon,
  world: WorldIcon,
  cloud: CloudIcon,
  moon: MoonIcon,
  sun: SunIcon,
  flag: FlagIcon,
  gift: GiftIcon,
  dice: DiceFiveFilledIcon,
  wrench: WrenchIcon,
  book: BookTextIcon,
  palette: PaletteIcon,
};

type ClassIconProps = {
  item: Pick<ClassCatalogItem, "label" | "color" | "icon_type" | "vector_icon" | "icon_key">;
  size?: number;
  framed?: boolean;
  className?: string;
  label?: string;
};

export function ClassIcon({
  item,
  size = 28,
  framed = true,
  className = "",
  label,
}: ClassIconProps) {
  const [failedImageKey, setFailedImageKey] = useState<string | null>(null);
  const Icon = CLASS_VECTOR_ICON_COMPONENTS[item.vector_icon] ?? SwordIcon;
  const showImage =
    item.icon_type === "image"
    && item.icon_key
    && failedImageKey !== item.icon_key;
  const iconSize = Math.max(12, Math.round(size * (framed ? 0.56 : 0.82)));
  const accessibleProps = label
    ? { role: "img", "aria-label": label }
    : { "aria-hidden": true };

  return (
    <span
      {...accessibleProps}
      className={`class-icon${framed ? " class-icon--framed" : ""}${className ? ` ${className}` : ""}`}
      style={{
        width: size,
        height: size,
        "--class-color": item.color,
      } as CSSProperties}
    >
      {showImage ? (
        <img
          src={resolveClassIconUrl(item.icon_key!)}
          alt=""
          className="class-icon__image"
          onError={() => setFailedImageKey(item.icon_key)}
        />
      ) : (
        <Icon size={iconSize} className="class-icon__vector" />
      )}
    </span>
  );
}
