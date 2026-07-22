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
      entrypoint: "src/main.ts",
    },
    views: {
      main: {
        entrypoint: "src/renderer/main.tsx",
      },
    },
    copy: {
      "src/renderer/index.html": "views/main/index.html",
    },
    mac: {
      codesign: false,
      createDmg: false,
    },
  },
} satisfies ElectrobunConfig;
