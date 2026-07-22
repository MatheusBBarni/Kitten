import type { ComponentType, SVGProps } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  EditPencil,
  Folder,
  DragHandGesture,
  InfoCircle,
  MoreHoriz,
  NavArrowDown,
  PathArrow,
  Pin,
  Play,
  Plus,
  Settings,
  TaskList,
  Trash,
  ViewColumns3,
  WarningTriangle,
  Xmark,
} from "iconoir-react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;
type IconComponent = ComponentType<IconProps>;

function applicationIcon(Icon: IconComponent) {
  return function ApplicationIcon(props: IconProps) {
    return (
      <Icon
        aria-hidden="true"
        width="16"
        height="16"
        strokeWidth="1.8"
        {...props}
      />
    );
  };
}

export const FolderIcon = applicationIcon(Folder);
export const DragHandleIcon = applicationIcon(DragHandGesture);
export const PlusIcon = applicationIcon(Plus);
export const MoreIcon = applicationIcon(MoreHoriz);
export const PinIcon = applicationIcon(Pin);
export const ArchiveIcon = applicationIcon(Archive);
export const TrashIcon = applicationIcon(Trash);
export const EditIcon = applicationIcon(EditPencil);
export const SettingsIcon = applicationIcon(Settings);
export const BoardIcon = applicationIcon(ViewColumns3);
export const ChevronDownIcon = applicationIcon(NavArrowDown);
export const ArrowLeftIcon = applicationIcon(ArrowLeft);
export const ArrowRightIcon = applicationIcon(ArrowRight);
export const AlertIcon = applicationIcon(WarningTriangle);
export const PlayIcon = applicationIcon(Play);
export const XIcon = applicationIcon(Xmark);
export const CheckIcon = applicationIcon(Check);
export const TaskIcon = applicationIcon(TaskList);
export const InfoIcon = applicationIcon(InfoCircle);
export const PathIcon = applicationIcon(PathArrow);
