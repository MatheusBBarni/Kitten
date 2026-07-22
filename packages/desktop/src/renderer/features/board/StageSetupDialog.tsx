import type { FormEvent } from "react";
import { Alert, Button, Input, Label, Modal, TextField } from "@heroui/react";
import type { WorkflowCatalogProjection } from "../../../shared/rpc.ts";
import type { SkillId } from "../../../workflow/workflowTypes.ts";
import { CatalogDiagnosticsList, uniqueCatalogDiagnostics } from "../../components/CatalogDiagnosticsList.tsx";
import { AlertIcon } from "../../components/Icons.tsx";
import { SearchableSelectField } from "../../components/SearchableSelectField.tsx";
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
  const diagnostics = uniqueCatalogDiagnostics(catalog.catalog.diagnostics);
  const canConfigure = label.trim().length > 0
    && selectedSkillId !== null
    && entries.some(({ skillId }) => skillId === selectedSkillId);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canConfigure && !busy) onCreate(true);
  }

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && !busy && onClose()}>
      <Modal.Container size="md" scroll="inside">
        <Modal.Dialog aria-label={mode === "create" ? "Add workflow stage" : `Configure ${label}`}>
          <form className="contents" onSubmit={submit} aria-busy={busy}>
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

              <SearchableSelectField
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
                placeholder="Select a validated Skill"
                emptyMessage="No matching Workflow Skills"
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
                <section className="min-w-0" aria-labelledby="catalog-diagnostics-title">
                  <div className="mb-2 flex items-baseline justify-between gap-4">
                    <h3 id="catalog-diagnostics-title" className="m-0">Catalog diagnostics</h3>
                    <span className="text-xs tabular-nums text-muted">{diagnostics.length}</span>
                  </div>
                  <CatalogDiagnosticsList diagnostics={diagnostics} maxHeightClassName="max-h-64" />
                </section>
              ) : null}
            </Modal.Body>
            <Modal.Footer className="flex flex-wrap justify-end gap-2">
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
