import { useState, type FormEvent } from "react";
import {
  Alert,
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
import type {
  AcpProviderProjection,
  FutureCardProfileDefaults,
  SettingsProfileProjection,
} from "../../../shared/desktopRpc.ts";
import type { WorkflowCatalogProjection } from "../../../shared/rpc.ts";
import type { SkillId, StageProjection } from "../../../workflow/workflowTypes.ts";
import { CheckIcon, InfoIcon, TaskIcon } from "../../components/Icons.tsx";
import { SearchableSelectField } from "../../components/SearchableSelectField.tsx";
import { SelectField } from "../../components/SelectField.tsx";
import { selectableCatalogEntries, type CardCreateInput } from "./boardInteractions.ts";

interface TaskCreateModalProps {
  readonly stages: readonly StageProjection[];
  readonly catalog: WorkflowCatalogProjection;
  readonly profiles: readonly SettingsProfileProjection[];
  readonly providers: readonly AcpProviderProjection[];
  readonly defaults: FutureCardProfileDefaults;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onCreate: (input: CardCreateInput) => void;
}

function normalizedProvider(value: string): string {
  return value.toLocaleLowerCase().replaceAll(/[^a-z0-9]+/g, "");
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function providerMatches(
  profileProvider: string,
  provider: Pick<AcpProviderProjection, "providerId" | "displayName">,
): boolean {
  const normalizedProfile = normalizedProvider(profileProvider);
  return normalizedProfile === normalizedProvider(provider.providerId)
    || normalizedProfile === normalizedProvider(provider.displayName);
}

export function TaskCreateModal({
  stages,
  catalog,
  profiles,
  providers,
  defaults,
  busy,
  onClose,
  onCreate,
}: TaskCreateModalProps) {
  const readyProfiles = profiles.filter(({ readiness }) => readiness.ready);
  const defaultProfile = readyProfiles.find(({ profileId }) => profileId === defaults.profileId)
    ?? readyProfiles[0]
    ?? profiles[0]
    ?? null;
  const availableProviders = providers.filter(({ availability }) => availability === "available");
  const providerOptions = [
    ...availableProviders.map((candidate) => ({
      value: candidate.providerId,
      label: candidate.displayName,
    })),
    ...profiles.flatMap((profile) => (
      availableProviders.some((provider) => providerMatches(profile.provider, provider))
        ? []
        : [{ value: profile.provider, label: profile.provider }]
    )),
  ].filter((option, index, all) => all.findIndex(({ value }) => value === option.value) === index);
  const defaultProvider = defaultProfile === null
    ? availableProviders[0]?.providerId ?? ""
    : availableProviders.find((candidate) => providerMatches(defaultProfile.provider, candidate))?.providerId
      ?? defaultProfile.provider;
  const defaultProviderProjection = providers.find(({ providerId }) => providerId === defaultProvider) ?? null;
  const defaultStage = stages[0] ?? null;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [stageId, setStageId] = useState(defaultStage?.stageId ?? "");
  const [provider, setProvider] = useState(defaultProvider);
  const [model, setModel] = useState(
    defaultProfile?.profileId === defaults.profileId
      ? defaults.model ?? defaultProfile?.models[0] ?? defaultProviderProjection?.models[0] ?? ""
      : defaultProfile?.models[0] ?? defaultProviderProjection?.models[0] ?? "",
  );
  const [effort, setEffort] = useState(
    defaultProfile?.profileId === defaults.profileId
      ? defaults.effort ?? defaultProfile?.efforts[0] ?? defaultProviderProjection?.efforts[0] ?? ""
      : defaultProfile?.efforts[0] ?? defaultProviderProjection?.efforts[0] ?? "",
  );
  const [skillOverrideId, setSkillOverrideId] = useState<string>("");
  const [runnable, setRunnable] = useState(
    defaultProfile?.readiness.ready === true && defaultStage?.configured === true,
  );
  const selectedProviderProjection = providers.find(({ providerId }) => providerId === provider) ?? null;
  const selectedProviderProfiles = profiles.filter((profile) => (
    selectedProviderProjection === null
      ? profile.provider === provider
      : providerMatches(profile.provider, selectedProviderProjection)
  ));
  const modelOptions = unique([
    ...(selectedProviderProjection?.models ?? []),
    ...selectedProviderProfiles.flatMap((profile) => profile.models),
  ]);
  const effortOptions = unique([
    ...(selectedProviderProjection?.efforts ?? []),
    ...selectedProviderProfiles.flatMap((profile) => profile.efforts),
  ]);
  const selectedProfile = readyProfiles.find((profile) => (
    selectedProviderProfiles.includes(profile)
      && profile.models.includes(model)
      && profile.efforts.includes(effort)
  )) ?? null;
  const selectedStage = stages.find((stage) => stage.stageId === stageId) ?? null;
  const valid = title.trim().length > 0
    && stageId.length > 0
    && providerOptions.some(({ value }) => value === provider)
    && modelOptions.includes(model)
    && effortOptions.includes(effort);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) return;
    onCreate({
      title,
      description,
      stageId: stageId as StageProjection["stageId"],
      provider: selectedProfile?.provider ?? provider,
      model,
      effort,
      skillOverrideId: skillOverrideId.length === 0 ? null : skillOverrideId as SkillId,
      runnable: runnable && selectedProfile !== null && selectedStage?.configured === true,
    });
  }

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && !busy && onClose()} isDismissable={!busy}>
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="max-h-[min(48rem,calc(100vh-2rem))] max-w-[64rem]">
          <Modal.CloseTrigger isDisabled={busy} />
          <Modal.Header>
            <Modal.Icon><TaskIcon /></Modal.Icon>
            <div>
              <Modal.Heading>Create task</Modal.Heading>
              <p className="field-help">Add work to a stage and choose the agent settings it will use.</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <form
              id="create-task-form"
              className="grid grid-cols-1 gap-5 min-[44rem]:grid-cols-2"
              onSubmit={submit}
              aria-busy={busy}
            >
              <fieldset className="col-span-full grid gap-4 rounded-xl border border-[var(--border)] p-4">
                <legend className="px-2 text-sm font-semibold text-foreground">Task details</legend>
                <TextField
                  value={title}
                  onChange={setTitle}
                  isRequired
                  isInvalid={title.length > 0 && title.trim().length === 0}
                  autoFocus
                >
                  <Label>Title</Label>
                  <Input variant="secondary" />
                  <FieldError>Enter a task title.</FieldError>
                </TextField>

                <TextField value={description} onChange={setDescription}>
                  <Label>Description (optional)</Label>
                  <TextArea variant="secondary" rows={4} />
                  <Description>Describe the outcome and constraints the agent should preserve.</Description>
                </TextField>
              </fieldset>

              <fieldset className="col-span-full grid grid-cols-1 gap-4 rounded-xl border border-[var(--border)] p-4 min-[52rem]:grid-cols-3">
                <legend className="px-2 text-sm font-semibold text-foreground">Agent configuration</legend>
                <SelectField
                  label="Stage"
                  value={stageId}
                  disabled={busy}
                  options={stages.map((stage) => ({ value: stage.stageId, label: stage.label }))}
                  onChange={(value) => {
                    setStageId(value);
                    const stage = stages.find(({ stageId: candidate }) => candidate === value);
                    if (!stage?.configured) setRunnable(false);
                  }}
                />

              {readyProfiles.length === 0 ? (
                <Alert className="col-span-full" status="warning">
                  <Alert.Indicator><InfoIcon /></Alert.Indicator>
                  <Alert.Content>
                    <Alert.Title>No ready task agents</Alert.Title>
                    <Alert.Description>
                      You can save a draft with a detected provider, but it cannot run until a matching agent profile is ready.
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}

                <SelectField
                label="Agent provider"
                value={provider}
                disabled={busy || providerOptions.length === 0}
                options={providerOptions}
                onChange={(value) => {
                  const nextProjection = providers.find(({ providerId }) => providerId === value) ?? null;
                  const nextProfiles = profiles.filter((profile) => (
                    nextProjection === null
                      ? profile.provider === value
                      : providerMatches(profile.provider, nextProjection)
                  ));
                  const nextModels = unique([
                    ...(nextProjection?.models ?? []),
                    ...nextProfiles.flatMap((profile) => profile.models),
                  ]);
                  const nextEfforts = unique([
                    ...(nextProjection?.efforts ?? []),
                    ...nextProfiles.flatMap((profile) => profile.efforts),
                  ]);
                  setProvider(value);
                  setModel(nextModels[0] ?? "");
                  setEffort(nextEfforts[0] ?? "");
                  setRunnable(false);
                }}
              />

              <SelectField
                label="Model"
                value={model}
                disabled={busy || modelOptions.length === 0}
                options={modelOptions.map((value) => ({ value, label: value }))}
                onChange={(value) => {
                  setModel(value);
                  if (!selectedProviderProfiles.some((profile) => profile.readiness.ready && profile.models.includes(value) && profile.efforts.includes(effort))) {
                    setRunnable(false);
                  }
                }}
                description={modelOptions.length === 0 ? "No models are available for this provider." : undefined}
              />
              <SelectField
                label="Effort"
                value={effort}
                disabled={busy || effortOptions.length === 0}
                options={effortOptions.map((value) => ({ value, label: value }))}
                onChange={(value) => {
                  setEffort(value);
                  if (!selectedProviderProfiles.some((profile) => profile.readiness.ready && profile.efforts.includes(value) && profile.models.includes(model))) {
                    setRunnable(false);
                  }
                }}
                description={effortOptions.length === 0 ? "No effort levels are available for this provider." : undefined}
              />
              </fieldset>

              <div className="col-span-full">
                <SearchableSelectField
                  label="Workflow Skill override"
                  value={skillOverrideId}
                  disabled={busy}
                  options={[
                    { value: "", label: "Use the stage default" },
                    ...selectableCatalogEntries(catalog).map((entry) => ({
                      value: entry.skillId,
                      label: `${entry.metadata.name} (${entry.rootClass})`,
                    })),
                  ]}
                  onChange={setSkillOverrideId}
                  placeholder="Search validated Skills"
                  emptyMessage="No matching Workflow Skills"
                />
              </div>

              <Checkbox
                className="col-span-full"
                isSelected={runnable}
                onChange={setRunnable}
                isDisabled={busy || selectedProfile === null || selectedStage?.configured !== true}
              >
                <Checkbox.Content>
                  <Checkbox.Control><Checkbox.Indicator><CheckIcon /></Checkbox.Indicator></Checkbox.Control>
                  <span>Ready to run</span>
                </Checkbox.Content>
              </Checkbox>
            </form>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onPress={onClose} isDisabled={busy}>Cancel</Button>
            <Button type="submit" form="create-task-form" isDisabled={!valid || busy} isPending={busy}>
              Create task
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
