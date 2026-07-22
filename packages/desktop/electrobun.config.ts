import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Kitten Orchestrator",
    identifier: "dev.kitten.orchestrator",
    version: "0.1.0",
    description: "Local-first governed Workflow Board",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    targets: "current",
    bun: {
      entrypoint: "src/index.ts",
    },
    views: {
      main: {
        entrypoint: "src/renderer/main.tsx",
      },
    },
    copy: {
      "src/renderer/index.html": "views/main/index.html",
      "src/renderer/generated.css": "views/main/styles.css",
    },
    mac: {
      codesign: false,
      createDmg: false,
      icons: "assets/kitten-icon.iconset",
    },
  },
} satisfies ElectrobunConfig;
