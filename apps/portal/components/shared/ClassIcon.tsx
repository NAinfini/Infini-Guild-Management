import type { ClassCatalogItem, ClassVectorIconId } from "@guild/shared";
import {
  AxeIcon,
  BoltIcon,
  BombIcon,
  BookTextIcon,
  BootIcon,
  BowIcon,
  ChaliceIcon,
  ClawIcon,
  CrownIcon,
  DaggerIcon,
  DiceFiveFilledIcon,
  FlagIcon,
  FlameIcon,
  GauntletIcon,
  GemIcon,
  HammerIcon,
  HeartIcon,
  HeartbeatIcon,
  LeafIcon,
  LuteIcon,
  MaskIcon,
  MoonIcon,
  OrbIcon,
  PendantIcon,
  PotionIcon,
  RingsIcon,
  ScrollIcon,
  ScytheIcon,
  ShieldIcon,
  SkullIcon,
  SnowflakeIcon,
  SparklesIcon,
  SpearIcon,
  StaffIcon,
  SunIcon,
  SwordIcon,
  SwordsIcon,
  TargetArrowIcon,
  TargetIcon,
  TridentIcon,
  TrophyIcon,
  WandIcon,
} from "@portal/components/icons";
import { useState, type ComponentType, type CSSProperties, type HTMLAttributes } from "react";
import { resolveMediaUrl } from "../../utils/media";
import "./ClassIcon.css";

type VectorIconComponent = ComponentType<HTMLAttributes<HTMLDivElement> & { size?: number }>;

/* 顺序照着 CLASS_VECTOR_ICON_IDS 走，方便对照哪个 id 还没配组件。 */
export const CLASS_VECTOR_ICON_COMPONENTS: Record<ClassVectorIconId, VectorIconComponent> = {
  sword: SwordIcon,
  swords: SwordsIcon,
  dagger: DaggerIcon,
  axe: AxeIcon,
  spear: SpearIcon,
  trident: TridentIcon,
  scythe: ScytheIcon,
  hammer: HammerIcon,
  claw: ClawIcon,
  gauntlet: GauntletIcon,
  shield: ShieldIcon,
  bow: BowIcon,
  target: TargetIcon,
  "target-arrow": TargetArrowIcon,
  bomb: BombIcon,
  staff: StaffIcon,
  wand: WandIcon,
  orb: OrbIcon,
  gem: GemIcon,
  sparkles: SparklesIcon,
  flame: FlameIcon,
  bolt: BoltIcon,
  snowflake: SnowflakeIcon,
  moon: MoonIcon,
  sun: SunIcon,
  heart: HeartIcon,
  heartbeat: HeartbeatIcon,
  potion: PotionIcon,
  chalice: ChaliceIcon,
  leaf: LeafIcon,
  book: BookTextIcon,
  scroll: ScrollIcon,
  lute: LuteIcon,
  crown: CrownIcon,
  trophy: TrophyIcon,
  flag: FlagIcon,
  mask: MaskIcon,
  pendant: PendantIcon,
  rings: RingsIcon,
  boot: BootIcon,
  skull: SkullIcon,
  dice: DiceFiveFilledIcon,
};

type ClassIconProps = {
  item: Pick<ClassCatalogItem, "label" | "color" | "icon_type" | "vector_icon" | "icon_media_id">;
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
  const [failedMediaId, setFailedMediaId] = useState<string | null>(null);
  const Icon = item.vector_icon ? CLASS_VECTOR_ICON_COMPONENTS[item.vector_icon] : null;
  const showImage =
    item.icon_type === "image"
    && item.icon_media_id
    && failedMediaId !== item.icon_media_id;
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
          src={resolveMediaUrl(item.icon_media_id!)}
          alt=""
          className="class-icon__image"
          onError={() => setFailedMediaId(item.icon_media_id)}
        />
      ) : item.icon_type === "vector" && Icon ? (
        <Icon size={iconSize} className="class-icon__vector" />
      ) : null}
    </span>
  );
}
