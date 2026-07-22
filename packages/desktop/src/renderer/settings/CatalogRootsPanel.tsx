import { useState, type FormEvent } from "react";
import { Alert, Button, Card, Label, TextArea, TextField } from "@heroui/react";
import type { CatalogProjection } from "../../persistence/eventJournal.ts";

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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ projectRoots: rootLines(projectRoots), userRoots: rootLines(userRoots) });
  }

  return (
    <Card className="settings-panel" aria-labelledby="catalog-roots-title">
      <Card.Header><div><Card.Title id="catalog-roots-title">Skill Catalog roots</Card.Title><Card.Description>Project roots take precedence over user roots. Skills come from validated catalog entries, never a typed name.</Card.Description></div></Card.Header>
      <Card.Content className="grid gap-4">

      <form className="settings-form" onSubmit={submit} aria-busy={busy}>
        <TextField className="field" value={projectRoots} onChange={setProjectRoots} isDisabled={busy}>
          <Label>Project roots</Label>
          <TextArea
            id="catalog-project-roots"
            name="projectRoots"
            rows={3}
            aria-describedby="project-roots-help"
            variant="secondary"
          />
          <p id="project-roots-help" className="field-help">One local directory per line.</p>
        </TextField>
        <TextField className="field" value={userRoots} onChange={setUserRoots} isDisabled={busy}>
          <Label>User roots</Label>
          <TextArea
            id="catalog-user-roots"
            name="userRoots"
            rows={3}
            aria-describedby="user-roots-help"
            variant="secondary"
          />
          <p id="user-roots-help" className="field-help">One local directory per line.</p>
        </TextField>
        <Button type="submit" isDisabled={busy} isPending={busy}>Save and scan roots</Button>
      </form>

      <div className="catalog-diagnostics-grid">
        <div>
          <h3>Configured roots</h3>
          {catalog.roots.length === 0 ? <p>No catalog roots configured.</p> : (
            <ul>
              {catalog.roots.map((root) => (
                <li key={`${root.rootClass}:${root.configuredPath}`}>
                  <strong>{root.rootClass}</strong>: {root.configuredPath}
                  {root.canonicalPath === null
                    ? " — invalid"
                    : root.canonicalPath === root.configuredPath
                      ? " — canonical"
                      : ` → ${root.canonicalPath}`}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>Validated Skills</h3>
          {catalog.entries.length === 0 ? <p>No validated Skills found.</p> : (
            <ul>
              {catalog.entries.map((entry) => (
                <li key={entry.skillId}>
                  <strong>{entry.metadata.name}</strong> ({entry.rootClass})
                  {entry.hasNameCollision ? " — name collision" : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div aria-labelledby="catalog-diagnostics-title">
        <h3 id="catalog-diagnostics-title">Catalog diagnostics</h3>
        {catalog.diagnostics.length === 0 ? <p>No catalog diagnostics.</p> : (
          <ul className="diagnostic-list">
            {catalog.diagnostics.map((diagnostic) => (
              <li key={diagnostic.diagnosticId}>
                <Alert status={diagnostic.severity === "error" ? "danger" : "warning"}>
                  <Alert.Content><Alert.Title>{diagnostic.code.replaceAll("_", " ")}</Alert.Title><Alert.Description>{diagnostic.message}</Alert.Description></Alert.Content>
                </Alert>
              </li>
            ))}
          </ul>
        )}
      </div>
      </Card.Content>
    </Card>
  );
}
