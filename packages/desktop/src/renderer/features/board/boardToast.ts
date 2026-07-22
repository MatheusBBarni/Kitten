import { toast } from "@heroui/react";

export interface BoardToastMessage {
  readonly message: string;
  readonly tone: "success" | "info" | "error";
}

const TOAST_TIMEOUT_MS = 5_000;

export function showBoardToast({ message, tone }: BoardToastMessage): string {
  const options = { timeout: TOAST_TIMEOUT_MS };
  if (tone === "error") return toast.danger(message, options);
  if (tone === "info") return toast.info(message, options);
  return toast.success(message, options);
}
