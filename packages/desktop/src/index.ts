import { startDesktopBootstrap } from "./bootstrap.ts";
import { main } from "./main.ts";

await startDesktopBootstrap({
  start: main,
  reportStartupFailure(error) {
    console.error("[kitten-desktop] Native startup failed:", error);
  },
});
