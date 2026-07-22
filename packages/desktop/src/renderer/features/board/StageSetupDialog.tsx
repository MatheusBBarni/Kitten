import type { FormEvent } from "react";
import { Alert, Button, Input, Label, Modal, TextField } from "@heroui/react";
import type { WorkflowCatalogProjection } from "../../../shared/rpc.ts";
import type { SkillId } from "../../../workflow/workflowTypes.ts";
import { AlertIcon } from "../../components/Icons.tsx";
import { SelectField } from "../../components/SelectField.tsx";
import { selectableCatalogEntries } from "./boardInteractions.ts";

export interface StageSetupDialogProps {
  readonly mode?: "create" | "configure";
  readonly catalog: WorkflowCatalogProjection;
  readonly label: string;
  readonly selectedSkillId: SkillId | null;
  readonly busy: boolean;
  readonly onLabelChange: (label: string) => void;
  readonly onSkillChange: (skillId: SkillId | null) => void;
  readonly onCreate: (configured: boolean) => void;
  readonly onClose: () => void;
}

export function StageSetupDialog({
  catalog,
  label,
  selectedSkillId,
  busy,
  onLabelChange,
  onSkillChange,
  onCreate,
  onClose,
  mode = "create",
}: StageSetupDialogProps) {
  const entries = selectableCatalogEntries(catalog);
  const diagnostics = catalog.catalog.diagnostics;
  const canConfigure = label.trim().length > 0
    && selectedSkillId !== null
    && entries.some(({ skillId }) => skillId === selectedSkillId);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canConfigure && !busy) onCreate(true);
  }

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && !busy && onClose()}>
      <Modal.Container size="md">
        <Modal.Dialog aria-label={mode === "create" ? "Add workflow stage" : `Configure ${label}`}>
          <form onSubmit={submit} aria-busy={busy}>
            <Modal.CloseTrigger isDisabled={busy} />
            <Modal.Header>
              <Modal.Heading>
                {mode === "create" ? "Add workflow stage" : `Configure ${label}`}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="grid gap-4">
              <p className="field-help">
                {mode === "create" ? "Name the stage and choose" : "Choose"} its default validated Workflow Skill.
                Skill names cannot be typed manually.
              </p>

              {mode === "create" ? (
                <TextField value={label} onChange={onLabelChange} autoFocus isRequired isDisabled={busy}>
                  <Label>Stage name</Label>
                  <Input variant="secondary" />
                </TextField>
              ) : null}

              <SelectField
                label="Default Workflow Skill"
                value={selectedSkillId ?? ""}
                options={[
                  { value: "", label: "Select a validated Skill" },
                  ...entries.map((entry) => ({
                    value: entry.skillId,
                    label: `${entry.metadata.name} (${entry.rootClass})`,
                  })),
                ]}
                onChange={(value) => onSkillChange(value.length === 0 ? null : value as SkillId)}
                disabled={busy || entries.length === 0}
                description="The host catalog supplies stable Skill identities. Catalog changes affect future attempts only."
              />

              {entries.length === 0 ? (
                <Alert status="warning">
                  <Alert.Indicator><AlertIcon /></Alert.Indicator>
                  <Alert.Content>
                    <Alert.Title>No valid Workflow Skills</Alert.Title>
                    <Alert.Description>
                      {mode === "create"
                        ? "You can add the stage as unconfigured, but it cannot launch work."
                        : "Fix the catalog diagnostics before configuring this stage."}
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}

              {diagnostics.length > 0 ? (
                <section className="catalog-diagnostics" aria-labelledby="catalog-diagnostics-title">
                  <h3 id="catalog-diagnostics-title">Catalog diagnostics</h3>
                  <ul>
                    {diagnostics.map((diagnostic) => (
                      <li key={diagnostic.diagnosticId}>
                        <strong>{diagnostic.code === "name_collision" ? "Name collision" : "Invalid catalog entry"}:</strong>{" "}
                        {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={onClose} isDisabled={busy}>Cancel</Button>
              {mode === "create" ? (
                <Button
                  variant="secondary"
                  isDisabled={busy || label.trim().length === 0}
                  aria-describedby="unconfigured-stage-help"
                  onPress={() => onCreate(false)}
                >
                  Add unconfigured stage
                </Button>
              ) : null}
              <span id="unconfigured-stage-help" className="sr-only">
                The stage will be visible but cannot launch work until a valid default Workflow Skill is assigned.
              </span>
              <Button type="submit" isDisabled={busy || !canConfigure} isPending={busy}>
                {busy
                  ? mode === "create" ? "Adding stage…" : "Saving Skill…"
                  : mode === "create" ? "Add configured stage" : "Save stage Skill"}
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
