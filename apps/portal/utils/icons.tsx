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
  BrushIcon,
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
  ArchiveIcon,
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

export const DashboardOutlined = withAnimated(LayoutGridIcon);
export const CalendarOutlined = withAnimated(CalendarDaysIcon);
export const NotificationOutlined = withAnimated(BellIcon);
export const TeamOutlined = withAnimated(UsersIcon);
export const ThunderboltOutlined = withAnimated(ZapIcon);
export const PictureOutlined = withAnimated(GalleryThumbnailsIcon);
export const BookOutlined = withAnimated(BookTextIcon);
export const SettingOutlined = withAnimated(SettingsIcon);
export const ToolOutlined = withAnimated(WrenchIcon);
export const UserOutlined = withAnimated(UserIcon);
export const MoonOutlined = withAnimated(MoonIcon);
export const SunOutlined = withAnimated(SunIcon);
export const TranslationOutlined = withAnimated(WorldIcon);
export const EllipsisOutlined = withAnimated(DotsIcon);
export const DownOutlined = withAnimated(ChevronDownIcon);
export const LogoutOutlined = withAnimated(LogOutIcon);
export const EyeOutlined = withAnimated(EyeIcon);
export const GoToOutlined = withAnimated(ExternalLinkIcon);
export const SearchOutlined = withAnimated(SearchIcon);
export const FileSearchOutlined = withAnimated(FileSearchIcon);
export const ArchiveOutlined = withAnimated(ArchiveIcon);
export const WarehouseOutlined = withAnimated(WarehouseIcon);
export const FormatPainterOutlined = withAnimated(BrushIcon);
export const PushpinOutlined = withAnimated(PinIcon);
export const LeftOutlined = withAnimated(ChevronLeftIcon);
export const RightOutlined = withAnimated(ChevronRightIcon);
export const VolumeOutlined = withAnimated(VolumeIcon);
export const VolumeMutedOutlined = withAnimated(VolumeOffIcon);
export const SwordsOutlined = withAnimated(SwordsIcon);
export const TrophyOutlined = withAnimated(TrophyIcon);
export const CrownOutlined = withAnimated(CrownIcon);
export const TargetOutlined = withAnimated(TargetIcon);
export const ShieldOutlined = withAnimated(ShieldIcon);
export const UserCheckOutlined = withAnimated(UserCheckIcon);
export const CalendarEventOutlined = withAnimated(CalendarEventIcon);
export const PencilOutlined = withAnimated(PencilIcon);
