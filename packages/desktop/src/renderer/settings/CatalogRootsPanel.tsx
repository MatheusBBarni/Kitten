import { useState, type FormEvent } from "react";
import { Button, Card, Chip, Label, TextArea, TextField } from "@heroui/react";
import type { CatalogProjection } from "../../persistence/eventJournal.ts";
import { CatalogDiagnosticsList, uniqueCatalogDiagnostics } from "../components/CatalogDiagnosticsList.tsx";

interface CatalogRootsPanelProps {
  readonly catalog: CatalogProjection;
  readonly busy: boolean;
  readonly onSave: (roots: {
    readonly projectRoots: readonly string[];
    readonly userRoots: readonly string[];
  }) => void;
}

function configuredRoots(catalog: CatalogProjection, rootClass: "project" | "user"): string {
  return catalog.roots
    .filter((root) => root.rootClass === rootClass)
    .map((root) => root.configuredPath)
    .join("\n");
}

export function rootLines(value: string): readonly string[] {
  return value.split(/\r?\n/).map((root) => root.trim()).filter(Boolean);
}

export function CatalogRootsPanel({ catalog, busy, onSave }: CatalogRootsPanelProps) {
  const [projectRoots, setProjectRoots] = useState(configuredRoots(catalog, "project"));
  const [userRoots, setUserRoots] = useState(configuredRoots(catalog, "user"));
  const diagnostics = uniqueCatalogDiagnostics(catalog.diagnostics);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ projectRoots: rootLines(projectRoots), userRoots: rootLines(userRoots) });
  }

  return (
    <Card className="settings-panel" aria-labelledby="catalog-roots-title">
      <Card.Header>
        <div>
          <Card.Title id="catalog-roots-title">Skill Catalog roots</Card.Title>
          <Card.Description>
            Project Skills replace user Skills with the same name. Skills come from validated catalog entries, never a typed name.
          </Card.Description>
        </div>
      </Card.Header>
      <Card.Content className="grid gap-4">
        <form className="settings-form" onSubmit={submit} aria-busy={busy}>
          <TextField className="field" value={projectRoots} onChange={setProjectRoots} isDisabled={busy}>
            <Label>Project roots</Label>
            <TextArea id="catalog-project-roots" name="projectRoots" rows={3} aria-describedby="project-roots-help" variant="secondary" />
            <p id="project-roots-help" className="field-help">One local directory per line.</p>
          </TextField>
          <TextField className="field" value={userRoots} onChange={setUserRoots} isDisabled={busy}>
            <Label>User roots</Label>
            <TextArea id="catalog-user-roots" name="userRoots" rows={3} aria-describedby="user-roots-help" variant="secondary" />
            <p id="user-roots-help" className="field-help">One local directory per line.</p>
          </TextField>
          <Button type="submit" isDisabled={busy} isPending={busy}>Save and scan roots</Button>
        </form>

        <div className="grid grid-cols-1 gap-4 min-[44rem]:grid-cols-2">
          <section className="min-w-0" aria-labelledby="configured-roots-title">
            <div className="mb-2 flex items-baseline justify-between gap-4">
              <h3 id="configured-roots-title" className="m-0">Configured roots</h3>
              <span className="text-xs tabular-nums text-muted">{catalog.roots.length}</span>
            </div>
            {catalog.roots.length === 0 ? <p>No catalog roots configured.</p> : (
              <ul className="m-0 grid max-h-72 list-none gap-0 overflow-y-auto overscroll-contain rounded-lg border border-separator p-0">
                {catalog.roots.map((root) => (
                  <li key={`${root.rootClass}:${root.configuredPath}`} className="grid gap-1.5 border-t border-separator p-3 first:border-t-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Chip size="sm" variant="soft">{root.rootClass}</Chip>
                      <code className="truncate">{root.configuredPath}</code>
                    </div>
                    <span className={`pl-1 text-xs [overflow-wrap:anywhere]${root.canonicalPath === null ? " font-semibold text-danger" : " text-muted"}`}>
                      {root.canonicalPath === null
                        ? "Invalid or unavailable"
                        : root.canonicalPath === root.configuredPath
                          ? "Canonical path"
                          : `Resolves to ${root.canonicalPath}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="min-w-0" aria-labelledby="available-skills-title">
            <div className="mb-2 flex items-baseline justify-between gap-4">
              <h3 id="available-skills-title" className="m-0">Available Skills</h3>
              <span className="text-xs tabular-nums text-muted">{catalog.entries.length}</span>
            </div>
            {catalog.entries.length === 0 ? <p>No validated Skills found.</p> : (
              <ul className="m-0 grid max-h-72 list-none gap-0 overflow-y-auto overscroll-contain rounded-lg border border-separator p-0">
                {catalog.entries.map((entry) => (
                  <li key={entry.skillId} className="flex items-center justify-between gap-4 border-t border-separator p-3 first:border-t-0">
                    <strong>{entry.metadata.name}</strong>
                    <Chip size="sm" variant="soft">{entry.rootClass}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="min-w-0" aria-labelledby="catalog-diagnostics-title">
          <div className="mb-2 flex items-baseline justify-between gap-4">
            <h3 id="catalog-diagnostics-title" className="m-0">Catalog issues</h3>
            <span className="text-xs tabular-nums text-muted">{diagnostics.length}</span>
          </div>
          <CatalogDiagnosticsList diagnostics={diagnostics} />
        </section>
      </Card.Content>
    </Card>
  );
}
