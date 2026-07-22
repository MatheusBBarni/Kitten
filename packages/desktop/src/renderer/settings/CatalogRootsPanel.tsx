import { useState, type ChangeEvent, type FormEvent } from "react";
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

  function changeRoots(event: ChangeEvent<HTMLTextAreaElement>) {
    if (event.currentTarget.name === "projectRoots") {
      setProjectRoots(event.currentTarget.value);
    } else {
      setUserRoots(event.currentTarget.value);
    }
  }

  return (
    <section className="settings-panel" aria-labelledby="catalog-roots-title">
      <h2 id="catalog-roots-title">Skill Catalog roots</h2>
      <p>Project roots take precedence over user roots. Skills are selected from validated catalog entries, never by free-text name.</p>

      <form className="settings-form" onSubmit={submit} aria-busy={busy}>
        <div className="field">
          <label htmlFor="catalog-project-roots">Project roots</label>
          <textarea
            id="catalog-project-roots"
            name="projectRoots"
            rows={3}
            value={projectRoots}
            disabled={busy}
            onChange={changeRoots}
            aria-describedby="project-roots-help"
          />
          <small id="project-roots-help">One local directory per line.</small>
        </div>
        <div className="field">
          <label htmlFor="catalog-user-roots">User roots</label>
          <textarea
            id="catalog-user-roots"
            name="userRoots"
            rows={3}
            value={userRoots}
            disabled={busy}
            onChange={changeRoots}
            aria-describedby="user-roots-help"
          />
          <small id="user-roots-help">One local directory per line.</small>
        </div>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? "Scanning catalog roots…" : "Save and scan roots"}
        </button>
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
              <li key={diagnostic.diagnosticId} className={diagnostic.severity === "error" ? "notice notice-error" : "notice notice-warning"}>
                <strong>{diagnostic.code.replaceAll("_", " ")}:</strong> {diagnostic.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
