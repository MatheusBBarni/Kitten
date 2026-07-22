import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DesktopRpcClient } from "../client.ts";
import type {
  SettingsSection,
  SettingsTheme,
  UpdateCatalogRootsInput,
  UpdateProfileDefaultsInput,
} from "../../shared/desktopRpc.ts";
import {
  desktopQueryKeys,
  settingsQueryOptions,
} from "../query/desktopQueries.ts";
import { settingsUnavailableMessage } from "./settingsQueries.ts";
import type { SettingsFeedbackValue } from "./SettingsView.tsx";

type SettingsMutation =
  | { readonly section: "preferences"; readonly revision: number; readonly theme: SettingsTheme }
  | {
      readonly section: "profile_defaults";
      readonly revision: number;
      readonly defaults: Omit<UpdateProfileDefaultsInput, "expectedRevision">;
    }
  | {
      readonly section: "catalog_roots";
      readonly revision: number;
      readonly roots: Omit<UpdateCatalogRootsInput, "expectedRevision">;
    }
  | { readonly section: "execution_limit"; readonly revision: number; readonly limit: number };

const successMessages: Readonly<Record<SettingsSection, string>> = {
  preferences: "Theme preference saved.",
  profile_defaults: "Task defaults saved.",
  catalog_roots: "Catalog roots saved and scanned.",
  execution_limit: "Automatic execution limit saved.",
};

function commandId(section: SettingsSection): string {
  return `settings:${section}:${crypto.randomUUID()}`;
}

export function useSettingsController(client: DesktopRpcClient) {
  const queryClient = useQueryClient();
  const query = useQuery(settingsQueryOptions(client));
  const [feedback, setFeedback] = useState<SettingsFeedbackValue | null>(null);
  const mutation = useMutation({
    mutationFn: (input: SettingsMutation) => {
      if (input.section === "preferences") {
        return client.updatePreferences(commandId(input.section), {
          expectedRevision: input.revision,
          theme: input.theme,
        });
      }
      if (input.section === "profile_defaults") {
        return client.updateProfileDefaults(commandId(input.section), {
          expectedRevision: input.revision,
          ...input.defaults,
        });
      }
      if (input.section === "catalog_roots") {
        return client.updateCatalogRoots(commandId(input.section), {
          expectedRevision: input.revision,
          ...input.roots,
        });
      }
      return client.setExecutionLimit(commandId(input.section), {
        expectedRevision: input.revision,
        limit: input.limit,
      });
    },
    onSuccess(envelope, input) {
      if (envelope.result.status === "ok") {
        queryClient.setQueryData(desktopQueryKeys.settings, {
          kind: "desktop_settings",
          result: { status: "ok", projection: envelope.result.projection },
        });
        setFeedback({ tone: "status", message: successMessages[input.section] });
        return;
      }
      if (envelope.result.status === "conflict") {
        setFeedback({
          tone: "error",
          message: `Settings changed before this action was committed. Expected revision ${envelope.result.conflict.expectedRevision}, now ${envelope.result.conflict.actualRevision}. Review the refreshed values and try again.`,
        });
        void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.settings });
        return;
      }
      if (envelope.result.status === "rejected") {
        setFeedback({ tone: "error", message: envelope.result.rejection.message });
        return;
      }
      setFeedback({ tone: "error", message: settingsUnavailableMessage() });
    },
    onError() {
      setFeedback({ tone: "error", message: settingsUnavailableMessage() });
    },
  });

  const envelope = query.data;
  const projection = envelope?.result.status === "ok" ? envelope.result.projection : null;
  const unavailable = query.isError || envelope?.result.status === "unavailable";
  const revision = projection?.revision;

  return {
    projection,
    feedback,
    loading: query.isPending,
    unavailable,
    busySection: mutation.isPending ? mutation.variables?.section ?? null : null,
    retry: query.refetch,
    saveTheme(theme: SettingsTheme) {
      if (revision !== undefined) mutation.mutate({ section: "preferences", revision, theme });
    },
    saveProfileDefaults(defaults: Omit<UpdateProfileDefaultsInput, "expectedRevision">) {
      if (revision !== undefined) mutation.mutate({ section: "profile_defaults", revision, defaults });
    },
    saveCatalogRoots(roots: Omit<UpdateCatalogRootsInput, "expectedRevision">) {
      if (revision !== undefined) mutation.mutate({ section: "catalog_roots", revision, roots });
    },
    saveExecutionLimit(limit: number) {
      if (revision !== undefined) mutation.mutate({ section: "execution_limit", revision, limit });
    },
  };
}
