import {
  IconAdjustments,
  IconBell,
  IconBook,
  IconBolt,
  IconBrush,
  IconCalendar,
  IconCalendarEvent,
  IconChevronDown,
  IconCopy,
  IconCrown,
  IconDots,
  IconChevronLeft,
  IconChevronRight,
  IconEye,
  IconExternalLink,
  IconFileSearch,
  IconFlame,
  IconHammer,
  IconHeart,
  IconLayoutDashboard,
  IconLock,
  IconLockOpen,
  IconLogout,
  IconMoon,
  IconSun,
  IconPin,
  IconPlayerPlay,
  IconPhoto,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconShare,
  IconShield,
  IconSwords,
  IconTarget,
  IconTool,
  IconTrophy,
  IconUser,
  IconAlertTriangle,
  IconPencil,
  IconPlus,
  IconUserCheck,
  IconUsers,
  IconVolume,
  IconVolumeOff,
  IconWorld,
  type IconProps,
} from "@tabler/icons-react";
import type { ComponentType } from "react";

type PortalIcon = ComponentType<IconProps>;

function withDefaults(Icon: PortalIcon): PortalIcon {
  return function PortalIconWithDefaults(props: IconProps) {
    return <Icon size={16} stroke={1.9} {...props} />;
  };
}

export const DashboardOutlined = withDefaults(IconLayoutDashboard);
export const CalendarOutlined = withDefaults(IconCalendar);
export const NotificationOutlined = withDefaults(IconBell);
export const TeamOutlined = withDefaults(IconUsers);
export const ThunderboltOutlined = withDefaults(IconBolt);
export const PictureOutlined = withDefaults(IconPhoto);
export const BookOutlined = withDefaults(IconBook);
export const SettingOutlined = withDefaults(IconSettings);
export const ToolOutlined = withDefaults(IconTool);
export const UserOutlined = withDefaults(IconUser);
export const ControlOutlined = withDefaults(IconAdjustments);
export const FireOutlined = withDefaults(IconFlame);
export const MoonOutlined = withDefaults(IconMoon);
export const SunOutlined = withDefaults(IconSun);
export const TranslationOutlined = withDefaults(IconWorld);
export const EllipsisOutlined = withDefaults(IconDots);
export const DownOutlined = withDefaults(IconChevronDown);
export const LogoutOutlined = withDefaults(IconLogout);
export const EyeOutlined = withDefaults(IconEye);
export const GoToOutlined = withDefaults(IconExternalLink);
export const SearchOutlined = withDefaults(IconSearch);
export const FileSearchOutlined = withDefaults(IconFileSearch);
export const CopyOutlined = withDefaults(IconCopy);
export const LockOutlined = withDefaults(IconLock);
export const UnlockOutlined = withDefaults(IconLockOpen);
export const FormatPainterOutlined = withDefaults(IconBrush);
export const MoreOutlined = withDefaults(IconDots);
export const PushpinOutlined = withDefaults(IconPin);
export const PlayCircleOutlined = withDefaults(IconPlayerPlay);
export const LeftOutlined = withDefaults(IconChevronLeft);
export const RightOutlined = withDefaults(IconChevronRight);
export const SyncOutlined = withDefaults(IconRefresh);
export const VolumeOutlined = withDefaults(IconVolume);
export const VolumeMutedOutlined = withDefaults(IconVolumeOff);
export const SwordsOutlined = withDefaults(IconSwords);
export const TrophyOutlined = withDefaults(IconTrophy);
export const CrownOutlined = withDefaults(IconCrown);
export const TargetOutlined = withDefaults(IconTarget);
export const ShieldOutlined = withDefaults(IconShield);
export const HeartOutlined = withDefaults(IconHeart);
export const HammerOutlined = withDefaults(IconHammer);
export const UserCheckOutlined = withDefaults(IconUserCheck);
export const CalendarEventOutlined = withDefaults(IconCalendarEvent);
export const PencilOutlined = withDefaults(IconPencil);
export const PlusOutlined = withDefaults(IconPlus);
export const ShareOutlined = withDefaults(IconShare);
export const AlertOutlined = withDefaults(IconAlertTriangle);
