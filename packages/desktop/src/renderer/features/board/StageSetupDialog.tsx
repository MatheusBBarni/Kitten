import type { FormEvent, RefObject } from "react";
import type { WorkflowCatalogProjection } from "../../../shared/rpc.ts";
import type { SkillId } from "../../../workflow/workflowTypes.ts";
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
  readonly dialogRef?: RefObject<HTMLDialogElement | null>;
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
  dialogRef,
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
    <dialog
      ref={dialogRef}
      className="stage-dialog"
      aria-labelledby="stage-dialog-title"
      aria-describedby="stage-dialog-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} aria-busy={busy}>
        <header className="dialog-header">
          <div>
            <h2 id="stage-dialog-title">
              {mode === "create" ? "Add Workflow Stage" : `Configure ${label}`}
            </h2>
            <p id="stage-dialog-description">
              {mode === "create" ? "Name the stage and choose" : "Choose"} its default validated Workflow Skill.
              Skill names cannot be typed manually.
            </p>
          </div>
          <button type="button" className="button button-ghost" onClick={onClose} disabled={busy}>
            Close stage setup
          </button>
        </header>

        {mode === "create" ? (
          <label className="field">
            <span>Stage name</span>
            <input
              autoFocus
              required
              value={label}
              onChange={(event) => onLabelChange(event.currentTarget.value)}
              disabled={busy}
            />
          </label>
        ) : null}

        <label className="field">
          <span>Default Workflow Skill</span>
          <select
            autoFocus={mode === "configure"}
            required
            value={selectedSkillId ?? ""}
            aria-describedby="stage-skill-help"
            onChange={(event) => onSkillChange(
              event.currentTarget.value.length === 0
                ? null
                : event.currentTarget.value as SkillId,
            )}
            disabled={busy || entries.length === 0}
          >
            <option value="">Select a validated Skill</option>
            {entries.map((entry) => (
              <option key={entry.skillId} value={entry.skillId}>
                {entry.metadata.name} ({entry.rootClass})
              </option>
            ))}
          </select>
          <small id="stage-skill-help">
            The host catalog supplies stable Skill identities. Catalog changes affect future attempts only.
          </small>
        </label>

        {entries.length === 0 ? (
          <p role="alert" className="notice notice-warning">
            {mode === "create"
              ? "No valid Workflow Skills are available. You can add the stage as unconfigured, but it cannot launch work."
              : "No valid Workflow Skills are available. Fix the catalog diagnostics before configuring this stage."}
          </p>
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

        <footer className="dialog-actions">
          {mode === "create" ? (
            <>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy || label.trim().length === 0}
                aria-describedby="unconfigured-stage-help"
                onClick={() => onCreate(false)}
              >
                Add unconfigured stage
              </button>
              <span id="unconfigured-stage-help" className="sr-only">
                The stage will be visible but cannot launch work until a valid default Workflow Skill is assigned.
              </span>
            </>
          ) : null}
          <button type="submit" className="button button-primary" disabled={busy || !canConfigure}>
            {busy
              ? mode === "create" ? "Adding stage…" : "Saving Skill…"
              : mode === "create" ? "Add configured stage" : "Save stage Skill"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
