import type { IconProps } from "@tabler/icons-react";
import type { ComponentType, HTMLAttributes, Ref } from "react";
import {
  LayoutGridIcon,
  BellIcon,
  UsersIcon,
  CalendarDaysIcon,
  ZapIcon,
  GalleryThumbnailsIcon,
  BookTextIcon,
  WrenchIcon,
  SettingsIcon,
  SearchIcon,
  SunIcon,
  MoonIcon,
  LogOutIcon,
  EyeIcon,
  PencilIcon,
  PinIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  SwordsIcon,
  TrophyIcon,
  CrownIcon,
  TargetIcon,
  ShieldIcon,
  UserCheckIcon,
  CalendarEventIcon,
  UserIcon,
  WorldIcon,
  DotsIcon,
  VolumeIcon,
  VolumeOffIcon,
  FileSearchIcon,
  WarehouseIcon,
} from "../components/icons";

interface IconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

type PortalIcon = ComponentType<IconProps>;

function withAnimated(AnimatedIcon: ComponentType<HTMLAttributes<HTMLDivElement> & { size?: number; ref?: Ref<IconHandle> }>): PortalIcon {
  function AnimatedPortalIcon(props: IconProps) {
    const size = (props.size as number) ?? 16;
    return <AnimatedIcon size={size} />;
  }
  AnimatedPortalIcon.displayName = `Animated(${(AnimatedIcon as { displayName?: string }).displayName ?? "Icon"})`;
  return AnimatedPortalIcon;
}

export const DashboardOutlined = /* @__PURE__ */ withAnimated(LayoutGridIcon);
export const CalendarOutlined = /* @__PURE__ */ withAnimated(CalendarDaysIcon);
export const NotificationOutlined = /* @__PURE__ */ withAnimated(BellIcon);
export const TeamOutlined = /* @__PURE__ */ withAnimated(UsersIcon);
export const ThunderboltOutlined = /* @__PURE__ */ withAnimated(ZapIcon);
export const PictureOutlined = /* @__PURE__ */ withAnimated(GalleryThumbnailsIcon);
export const BookOutlined = /* @__PURE__ */ withAnimated(BookTextIcon);
export const SettingOutlined = /* @__PURE__ */ withAnimated(SettingsIcon);
export const ToolOutlined = /* @__PURE__ */ withAnimated(WrenchIcon);
export const UserOutlined = /* @__PURE__ */ withAnimated(UserIcon);
export const MoonOutlined = /* @__PURE__ */ withAnimated(MoonIcon);
export const SunOutlined = /* @__PURE__ */ withAnimated(SunIcon);
export const TranslationOutlined = /* @__PURE__ */ withAnimated(WorldIcon);
export const EllipsisOutlined = /* @__PURE__ */ withAnimated(DotsIcon);
export const DownOutlined = /* @__PURE__ */ withAnimated(ChevronDownIcon);
export const LogoutOutlined = /* @__PURE__ */ withAnimated(LogOutIcon);
export const EyeOutlined = /* @__PURE__ */ withAnimated(EyeIcon);
export const GoToOutlined = /* @__PURE__ */ withAnimated(ExternalLinkIcon);
export const SearchOutlined = /* @__PURE__ */ withAnimated(SearchIcon);
export const FileSearchOutlined = /* @__PURE__ */ withAnimated(FileSearchIcon);
export const WarehouseOutlined = /* @__PURE__ */ withAnimated(WarehouseIcon);
export const PushpinOutlined = /* @__PURE__ */ withAnimated(PinIcon);
export const LeftOutlined = /* @__PURE__ */ withAnimated(ChevronLeftIcon);
export const RightOutlined = /* @__PURE__ */ withAnimated(ChevronRightIcon);
export const VolumeOutlined = /* @__PURE__ */ withAnimated(VolumeIcon);
export const VolumeMutedOutlined = /* @__PURE__ */ withAnimated(VolumeOffIcon);
export const SwordsOutlined = /* @__PURE__ */ withAnimated(SwordsIcon);
export const TrophyOutlined = /* @__PURE__ */ withAnimated(TrophyIcon);
export const CrownOutlined = /* @__PURE__ */ withAnimated(CrownIcon);
export const TargetOutlined = /* @__PURE__ */ withAnimated(TargetIcon);
export const ShieldOutlined = /* @__PURE__ */ withAnimated(ShieldIcon);
export const UserCheckOutlined = /* @__PURE__ */ withAnimated(UserCheckIcon);
export const CalendarEventOutlined = /* @__PURE__ */ withAnimated(CalendarEventIcon);
export const PencilOutlined = /* @__PURE__ */ withAnimated(PencilIcon);
