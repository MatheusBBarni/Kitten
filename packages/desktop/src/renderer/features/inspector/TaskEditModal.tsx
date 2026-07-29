import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  Description,
  FieldError,
  Input,
  Label,
  Modal,
  TextArea,
  TextField,
} from "@heroui/react";
import type { WorkflowCatalogProjection } from "../../../shared/rpc.ts";
import type { CardProjection, SkillId } from "../../../workflow/workflowTypes.ts";
import { SearchableSelectField } from "../../components/SearchableSelectField.tsx";
import { selectableCatalogEntries, type CardEditInput } from "../board/boardInteractions.ts";
import { CheckIcon, EditIcon } from "../../components/Icons.tsx";

interface TaskEditModalProps {
  readonly card: CardProjection;
  readonly catalog: WorkflowCatalogProjection | undefined;
  readonly isOpen: boolean;
  readonly busy: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (input: CardEditInput) => void;
}

export function TaskEditModal({ card, catalog, isOpen, busy, onOpenChange, onSave }: TaskEditModalProps) {
  const skillEntries = catalog === undefined ? [] : selectableCatalogEntries(catalog);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [provider, setProvider] = useState(card.provider);
  const [model, setModel] = useState(card.model);
  const [effort, setEffort] = useState(card.effort);
  const [skillOverrideId, setSkillOverrideId] = useState<string>(card.skillOverrideId ?? "");
  const [runnable, setRunnable] = useState(card.runnable);

  useEffect(() => {
    if (!isOpen) return;
    setTitle(card.title);
    setDescription(card.description);
    setProvider(card.provider);
    setModel(card.model);
    setEffort(card.effort);
    setSkillOverrideId(card.skillOverrideId ?? "");
    setRunnable(card.runnable);
  }, [card, isOpen]);

  const valid = title.trim().length > 0
    && provider.trim().length > 0
    && model.trim().length > 0
    && effort.trim().length > 0;

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={!busy}>
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog>
          <Modal.CloseTrigger isDisabled={busy} />
          <Modal.Header>
            <Modal.Icon><EditIcon /></Modal.Icon>
            <Modal.Heading>Edit task</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                className="sm:col-span-2"
                value={title}
                onChange={setTitle}
                isRequired
                isInvalid={title.trim().length === 0}
                autoFocus
              >
                <Label>Title</Label>
                <Input variant="secondary" />
                <FieldError>Enter a task title.</FieldError>
              </TextField>

              <TextField className="sm:col-span-2" value={description} onChange={setDescription}>
                <Label>Description</Label>
                <TextArea variant="secondary" rows={5} />
                <Description>Describe the outcome and constraints the agent should preserve.</Description>
              </TextField>

              <TextField value={provider} onChange={setProvider} isRequired isInvalid={provider.trim().length === 0}>
                <Label>Provider</Label>
                <Input variant="secondary" />
                <FieldError>Enter a provider.</FieldError>
              </TextField>

              <TextField value={model} onChange={setModel} isRequired isInvalid={model.trim().length === 0}>
                <Label>Model</Label>
                <Input variant="secondary" />
                <FieldError>Enter a model.</FieldError>
              </TextField>

              <TextField value={effort} onChange={setEffort} isRequired isInvalid={effort.trim().length === 0}>
                <Label>Effort</Label>
                <Input variant="secondary" />
                <FieldError>Enter an effort level.</FieldError>
              </TextField>

              <div className="sm:col-span-2">
                <SearchableSelectField
                  label="Workflow Skill"
                  value={skillOverrideId}
                  disabled={busy}
                  options={[
                    { value: "", label: "Select a Workflow Skill" },
                    ...skillEntries.map((entry) => ({
                      value: entry.skillId,
                      label: `${entry.metadata.name} (${entry.rootClass})`,
                    })),
                  ]}
                  onChange={(value) => {
                    setSkillOverrideId(value);
                    if (value.length === 0) setRunnable(false);
                  }}
                  placeholder="Search validated Skills"
                  emptyMessage="No matching Workflow Skills"
                  description="Moving this task to another stage clears the Skill."
                />
              </div>

              <Checkbox
                isSelected={runnable}
                onChange={setRunnable}
                className="self-end"
                isDisabled={busy || skillOverrideId.length === 0}
              >
                <Checkbox.Content>
                  <Checkbox.Control><Checkbox.Indicator><CheckIcon /></Checkbox.Indicator></Checkbox.Control>
                  <span>Runnable task</span>
                </Checkbox.Content>
              </Checkbox>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onPress={() => onOpenChange(false)} isDisabled={busy}>Cancel</Button>
            <Button
              onPress={() => onSave({
                title,
                description,
                provider,
                model,
                effort,
                skillOverrideId: skillOverrideId.length === 0 ? null : skillOverrideId as SkillId,
                runnable: runnable && skillOverrideId.length > 0,
              })}
              isDisabled={!valid || busy}
              isPending={busy}
            >
              Save task
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
