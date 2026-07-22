import { Card, Chip } from "@heroui/react";
import type { AcpProviderProjection } from "../../shared/desktopRpc.ts";

export function AcpProvidersPanel({
  providers,
}: {
  readonly providers: readonly AcpProviderProjection[];
}) {
  return (
    <Card className="settings-panel" aria-labelledby="acp-providers-title">
      <Card.Header>
        <div>
          <Card.Title id="acp-providers-title">Agent clients (ACP)</Card.Title>
          <Card.Description>
            Detected on this Mac and configured by Kitten. A detected client still needs a ready profile before it can run a task.
          </Card.Description>
        </div>
      </Card.Header>
      <Card.Content>
        {providers.length === 0 ? (
          <p className="m-0 text-sm text-muted">No ACP clients are configured in Kitten.</p>
        ) : (
          <ul className="m-0 grid list-none gap-0 p-0" aria-label="Configured ACP providers">
            {providers.map((provider) => (
              <li
                key={provider.providerId}
                className="flex min-h-14 items-center justify-between gap-4 border-t border-separator py-3 first:border-t-0 first:pt-0 last:pb-0"
              >
                <div className="grid gap-1">
                  <strong>{provider.displayName}</strong>
                  <span className="text-xs text-muted">
                    {provider.configuredBy === "kitten_config" ? "Kitten configuration" : "Built-in Kitten setup"}
                    {` · ${provider.configuredCommand}`}
                  </span>
                  <span className="text-xs text-muted">
                    {provider.models.length} model {provider.models.length === 1 ? "choice" : "choices"}
                    {` · ${provider.efforts.length} effort ${provider.efforts.length === 1 ? "level" : "levels"}`}
                  </span>
                </div>
                <div className="grid justify-items-end gap-1 text-right">
                  <Chip
                    size="sm"
                    variant="soft"
                    color={provider.availability === "available" ? "success" : "warning"}
                  >
                    {provider.availability === "available" ? "Detected" : "Not detected"}
                  </Chip>
                  {provider.detectedCommands.length === 0 ? null : (
                    <span className="text-xs text-muted">
                      {provider.detectedCommands.join(", ")}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card.Content>
    </Card>
  );
}
