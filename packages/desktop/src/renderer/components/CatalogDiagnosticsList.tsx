import type { CatalogDiagnostic } from "../../catalog/contracts.ts";
import { AlertIcon } from "./Icons.tsx";

interface CatalogDiagnosticsListProps {
  readonly diagnostics: readonly CatalogDiagnostic[];
  readonly emptyMessage?: string;
  readonly maxHeightClassName?: string;
}

function diagnosticTitle(code: string): string {
  return code
    .split("_")
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(" ");
}

export function uniqueCatalogDiagnostics(diagnostics: readonly CatalogDiagnostic[]): readonly CatalogDiagnostic[] {
  return diagnostics.filter((diagnostic, index, all) => all.findIndex((candidate) => (
    candidate.code === diagnostic.code
    && candidate.message === diagnostic.message
    && candidate.skillPath === diagnostic.skillPath
    && candidate.severity === diagnostic.severity
  )) === index);
}

export function CatalogDiagnosticsList({
  diagnostics,
  emptyMessage = "No catalog issues found.",
  maxHeightClassName = "max-h-[22rem]",
}: CatalogDiagnosticsListProps) {
  const visibleDiagnostics = uniqueCatalogDiagnostics(diagnostics);
  if (visibleDiagnostics.length === 0) return <p className="m-0 text-sm text-muted">{emptyMessage}</p>;

  return (
    <ul className={`m-0 grid list-none gap-0 overflow-y-auto overscroll-contain rounded-lg border border-separator p-0 ${maxHeightClassName}`}>
      {visibleDiagnostics.map((diagnostic) => (
        <li
          key={diagnostic.diagnosticId}
          className="grid grid-cols-[1rem_minmax(0,1fr)] gap-3 border-t border-separator p-3 first:border-t-0"
        >
          <span className={diagnostic.severity === "error" ? "text-danger" : "text-warning"}>
            <AlertIcon />
          </span>
          <div className="min-w-0">
            <strong>{diagnosticTitle(diagnostic.code)}</strong>
            <p className="mb-0 mt-1 text-xs leading-5 text-muted [overflow-wrap:anywhere]">{diagnostic.message}</p>
            {diagnostic.skillPath === null ? null : (
              <code className="mt-1.5 block text-[0.6875rem] text-muted [overflow-wrap:anywhere]">
                {diagnostic.skillPath}
              </code>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
