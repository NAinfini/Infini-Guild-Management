import type { IconProps } from "@tabler/icons-react";
import { useEffect, useRef, type ComponentType, type HTMLAttributes, type Ref } from "react";
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
  CopyIcon,
  PencilIcon,
  PlusIcon,
  PinIcon,
  RefreshCwIcon,
  ShareIcon,
  LockIcon,
  UnlockIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  AlertTriangleIcon,
  FlameIcon,
  SwordsIcon,
  TrophyIcon,
  CrownIcon,
  TargetIcon,
  ShieldIcon,
  HeartIcon,
  HammerIcon,
  UserCheckIcon,
  CalendarEventIcon,
  UserIcon,
  WorldIcon,
  DotsIcon,
  PlayIcon,
  VolumeIcon,
  VolumeOffIcon,
  FileSearchIcon,
  BrushIcon,
  AdjustmentsIcon,
  XIcon,
  SaveIcon,
  CheckIcon,
  TrashIcon,
  UploadIcon,
  ArchiveIcon,
  SendIcon,
  EyeOffIcon,
  ChevronUpIcon,
  ClipboardIcon,
  UserPlusIcon,
  PhotoIcon,
  VideoIcon,
  PauseIcon,
  CircleCheckIcon,
  CircleXIcon,
  InfoCircleIcon,
  ArrowLeftIcon,
  NoteIcon,
  CalendarTimeIcon,
  BoltIcon,
  SpeakerphoneIcon,
} from "../components/icons";

interface IconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

const INTERACTIVE_SELECTOR = "button, a, [role='button'], [role='menuitem'], [role='tab']";

type PortalIcon = ComponentType<IconProps>;

function withAnimated(AnimatedIcon: ComponentType<HTMLAttributes<HTMLDivElement> & { size?: number; ref?: Ref<IconHandle> }>): PortalIcon {
  return function AnimatedPortalIcon(props: IconProps) {
    const size = (props.size as number) ?? 16;
    const ref = useRef<IconHandle>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const el = wrapperRef.current;
      if (!el) return;
      const parent = el.closest(INTERACTIVE_SELECTOR) as HTMLElement | null;
      if (!parent) return;

      const onEnter = () => ref.current?.startAnimation();
      const onLeave = () => ref.current?.stopAnimation();
      parent.addEventListener("mouseenter", onEnter);
      parent.addEventListener("mouseleave", onLeave);
      return () => {
        parent.removeEventListener("mouseenter", onEnter);
        parent.removeEventListener("mouseleave", onLeave);
      };
    }, []);

    return (
      <div ref={wrapperRef} style={{ display: "inline-flex", lineHeight: 0 }}>
        <AnimatedIcon
          ref={ref}
          size={size}
          onMouseEnter={() => ref.current?.startAnimation()}
          onMouseLeave={() => ref.current?.stopAnimation()}
        />
      </div>
    );
  };
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
export const ControlOutlined = withAnimated(AdjustmentsIcon);
export const FireOutlined = withAnimated(FlameIcon);
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
export const CopyOutlined = withAnimated(CopyIcon);
export const LockOutlined = withAnimated(LockIcon);
export const UnlockOutlined = withAnimated(UnlockIcon);
export const FormatPainterOutlined = withAnimated(BrushIcon);
export const MoreOutlined = withAnimated(DotsIcon);
export const PushpinOutlined = withAnimated(PinIcon);
export const PlayCircleOutlined = withAnimated(PlayIcon);
export const LeftOutlined = withAnimated(ChevronLeftIcon);
export const RightOutlined = withAnimated(ChevronRightIcon);
export const SyncOutlined = withAnimated(RefreshCwIcon);
export const VolumeOutlined = withAnimated(VolumeIcon);
export const VolumeMutedOutlined = withAnimated(VolumeOffIcon);
export const SwordsOutlined = withAnimated(SwordsIcon);
export const TrophyOutlined = withAnimated(TrophyIcon);
export const CrownOutlined = withAnimated(CrownIcon);
export const TargetOutlined = withAnimated(TargetIcon);
export const ShieldOutlined = withAnimated(ShieldIcon);
export const HeartOutlined = withAnimated(HeartIcon);
export const HammerOutlined = withAnimated(HammerIcon);
export const UserCheckOutlined = withAnimated(UserCheckIcon);
export const CalendarEventOutlined = withAnimated(CalendarEventIcon);
export const PencilOutlined = withAnimated(PencilIcon);
export const PlusOutlined = withAnimated(PlusIcon);
export const ShareOutlined = withAnimated(ShareIcon);
export const AlertOutlined = withAnimated(AlertTriangleIcon);
export const CloseOutlined = withAnimated(XIcon);
export const SaveOutlined = withAnimated(SaveIcon);
export const CheckOutlined = withAnimated(CheckIcon);
export const DeleteOutlined = withAnimated(TrashIcon);
export const UploadOutlined = withAnimated(UploadIcon);
export const ArchiveOutlined = withAnimated(ArchiveIcon);
export const SendOutlined = withAnimated(SendIcon);
export const EyeOffOutlined = withAnimated(EyeOffIcon);
export const ChevronUpOutlined = withAnimated(ChevronUpIcon);
export const ClipboardOutlined = withAnimated(ClipboardIcon);
export const UserPlusOutlined = withAnimated(UserPlusIcon);
export const PhotoOutlined = withAnimated(PhotoIcon);
export const VideoOutlined = withAnimated(VideoIcon);
export const PauseOutlined = withAnimated(PauseIcon);
export const CircleCheckOutlined = withAnimated(CircleCheckIcon);
export const CircleXOutlined = withAnimated(CircleXIcon);
export const InfoCircleOutlined = withAnimated(InfoCircleIcon);
export const ArrowLeftOutlined = withAnimated(ArrowLeftIcon);
export const NoteOutlined = withAnimated(NoteIcon);
export const CalendarTimeOutlined = withAnimated(CalendarTimeIcon);
export const BoltOutlined = withAnimated(BoltIcon);
export const SpeakerphoneOutlined = withAnimated(SpeakerphoneIcon);
