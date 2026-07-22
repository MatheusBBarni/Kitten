import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function Icon({ children, ...props }: IconProps & { readonly children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return <Icon {...props}><path d="M3.5 6.5h6l2 2h9v9a2 2 0 0 1-2 2h-15z" /><path d="M3.5 6.5v-1a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1" /></Icon>;
}

export function PlusIcon(props: IconProps) {
  return <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>;
}

export function MoreIcon(props: IconProps) {
  return <Icon {...props}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></Icon>;
}

export function PinIcon(props: IconProps) {
  return <Icon {...props}><path d="m8 3 8 8" /><path d="m15 4 5 5-3 1-4 4-1 4-5-5 4-1 4-4z" /><path d="m9 15-5 5" /></Icon>;
}

export function ArchiveIcon(props: IconProps) {
  return <Icon {...props}><path d="M4 7h16v12H4z" /><path d="M3 3h18v4H3z" /><path d="M9 11h6" /></Icon>;
}

export function TrashIcon(props: IconProps) {
  return <Icon {...props}><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="m6 7 1 13h10l1-13" /><path d="M10 11v5M14 11v5" /></Icon>;
}

export function EditIcon(props: IconProps) {
  return <Icon {...props}><path d="M4 20h4l11-11-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></Icon>;
}

export function SettingsIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.5 1a7 7 0 0 0-1.7-1L14.5 3h-5L9 6a7 7 0 0 0-1.7 1L5 6 3 9.5 5 11a7 7 0 0 0 0 2l-2 1.5L5 18l2.3-1a7 7 0 0 0 1.7 1l.5 3h5l.5-3a7 7 0 0 0 1.7-1l2.3 1 2-3.5-2-1.5a7 7 0 0 0 .1-1" /></Icon>;
}

export function BoardIcon(props: IconProps) {
  return <Icon {...props}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></Icon>;
}

export function ChevronDownIcon(props: IconProps) {
  return <Icon {...props}><path d="m7 10 5 5 5-5" /></Icon>;
}

export function ArrowLeftIcon(props: IconProps) {
  return <Icon {...props}><path d="m14 7-5 5 5 5" /></Icon>;
}

export function ArrowRightIcon(props: IconProps) {
  return <Icon {...props}><path d="m10 7 5 5-5 5" /></Icon>;
}

export function AlertIcon(props: IconProps) {
  return <Icon {...props}><path d="M12 4 2.5 20h19z" /><path d="M12 9v4" /><path d="M12 17h.01" /></Icon>;
}

export function PlayIcon(props: IconProps) {
  return <Icon {...props}><path d="m8 5 11 7-11 7z" /></Icon>;
}

export function XIcon(props: IconProps) {
  return <Icon {...props}><path d="m6 6 12 12M18 6 6 18" /></Icon>;
}

export function CheckIcon(props: IconProps) {
  return <Icon {...props}><path d="m5 12 4 4L19 6" /></Icon>;
}
