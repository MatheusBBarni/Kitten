import { useEffect, useState } from "react";

export const NARROW_SHELL_MEDIA_QUERY = "(max-width: 55.999rem)";

export type ResponsiveShellMode = "wide" | "narrow";

function currentShellMode(): ResponsiveShellMode {
  if (
    typeof window === "undefined"
    || typeof window.matchMedia !== "function"
  ) {
    return "wide";
  }
  return window.matchMedia(NARROW_SHELL_MEDIA_QUERY).matches ? "narrow" : "wide";
}

export function useResponsiveShellMode(): ResponsiveShellMode {
  const [mode, setMode] = useState<ResponsiveShellMode>(currentShellMode);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(NARROW_SHELL_MEDIA_QUERY);
    const updateMode = () => setMode(mediaQuery.matches ? "narrow" : "wide");
    updateMode();
    mediaQuery.addEventListener("change", updateMode);
    return () => mediaQuery.removeEventListener("change", updateMode);
  }, []);

  return mode;
}
