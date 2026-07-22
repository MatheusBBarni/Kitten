import { useEffect, useRef } from "react";
import { StageSetupDialog, type StageSetupDialogProps } from "./StageSetupDialog.tsx";

export function StageSetupModal(props: StageSetupDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      returnFocusRef.current?.focus();
    };
  }, []);

  return <StageSetupDialog {...props} dialogRef={dialogRef} />;
}
