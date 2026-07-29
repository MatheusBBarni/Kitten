import type { FormEvent } from "react";
import { Button, Input, Label, Modal, TextField } from "@heroui/react";

export interface StageSetupDialogProps {
  readonly mode?: "create" | "configure";
  readonly label: string;
  readonly busy: boolean;
  readonly onLabelChange: (label: string) => void;
  readonly onSave: () => void;
  readonly onClose: () => void;
}

export function StageSetupDialog({
  label,
  busy,
  onLabelChange,
  onSave,
  onClose,
  mode = "create",
}: StageSetupDialogProps) {
  const valid = label.trim().length > 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (valid && !busy) onSave();
  }

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && !busy && onClose()}>
      <Modal.Container size="md" scroll="inside">
        <Modal.Dialog aria-label={mode === "create" ? "Add workflow stage" : `Edit ${label}`}>
          <form className="contents" onSubmit={submit} aria-busy={busy}>
            <Modal.CloseTrigger isDisabled={busy} />
            <Modal.Header>
              <Modal.Heading>
                {mode === "create" ? "Add workflow stage" : `Edit ${label}`}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="grid gap-4">
              <p className="field-help">
                Stages define workflow status only. Each task chooses its own Workflow Skill.
              </p>

              <TextField value={label} onChange={onLabelChange} autoFocus isRequired isDisabled={busy}>
                <Label>Stage name</Label>
                <Input variant="secondary" />
              </TextField>
            </Modal.Body>
            <Modal.Footer className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onPress={onClose} isDisabled={busy}>Cancel</Button>
              <Button type="submit" isDisabled={busy || !valid} isPending={busy}>
                {busy
                  ? mode === "create" ? "Adding stage…" : "Saving stage…"
                  : mode === "create" ? "Add stage" : "Save stage"}
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
