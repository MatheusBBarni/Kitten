export type ShowcaseSection = {
  readonly id: string;
  readonly heading: string;
  readonly body: string;
};

export type InstallVerificationSource = "verified-route";
export type InstallCommandSource =
  | InstallVerificationSource
  | "supported-alternative";
export type InstallCommandId = "npm" | "pnpm" | "bun";

export type InstallCommandSpec = {
  readonly id: InstallCommandId;
  readonly label: string;
  readonly command: string;
  readonly source: InstallCommandSource;
  readonly copyCtaLabel: string;
  readonly shellCopyHint: string;
  readonly verificationReference: string;
};

export type ShowcaseConfig = {
  readonly site: {
    readonly title: string;
    readonly description: string;
    readonly language: string;
  };
  readonly navigation: {
    readonly brandLabel: string;
    readonly brandAccessibleLabel: string;
    readonly proofLabel: string;
    readonly installLabel: string;
    readonly githubStarLabel: string;
  };
  readonly hero: ShowcaseSection & {
    readonly eyebrow: string;
    readonly primaryCtaLabel: string;
    readonly secondaryCtaLabel: string;
    readonly logoAlt: string;
    readonly outcomeTitle: string;
    readonly outcomeBody: string;
    readonly outcomeStatus: string;
    readonly benefits: readonly string[];
  };
  readonly proof: ShowcaseSection & {
    readonly accessibleDescription: string;
    readonly steps: readonly {
      readonly label: string;
      readonly description: string;
    }[];
  };
  readonly install: ShowcaseSection & {
    readonly primaryInstallCmd: string;
    readonly commands: readonly InstallCommandSpec[];
  };
  readonly requirements: ShowcaseSection & {
    readonly items: readonly string[];
  };
  readonly faq: ShowcaseSection & {
    readonly items: readonly {
      readonly question: string;
      readonly answer: string;
    }[];
  };
  readonly repository: {
    readonly owner: string;
    readonly name: string;
    readonly url: string;
    readonly star: {
      readonly loadingText: string;
      readonly loadingAccessibleLabel: string;
      readonly fallbackText: string;
      readonly accessibleLabel: string;
    };
  };
  readonly measurementNotes: ShowcaseSection;
};

export const repoOwner = "MatheusBBarni" as const;
export const repoName = "Kitten" as const;
export const repositoryUrl =
  `https://github.com/${repoOwner}/${repoName}` as const;
export const npmPackageName = "@matheusbbarni/kitten" as const;
export const installVerificationSource = "verified-route" as const;
export const primaryInstallCmd =
  `npm install --global ${npmPackageName}` as const;

const placeholderPattern =
  /(?:\b(?:todo|tbd|replace[-_ ]?me)\b|example\.com|github\.com\/owner\/)/i;

export function verifiedInstallRoutes(
  config: ShowcaseConfig,
): readonly InstallCommandSpec[] {
  return config.install.commands.filter(
    (command) => command.source === installVerificationSource,
  );
}

export function validateShowcaseConfig(
  config: ShowcaseConfig,
): readonly string[] {
  const errors: string[] = [];
  const requiredText: readonly (readonly [path: string, value: string])[] = [
    ["site.title", config.site.title],
    ["site.description", config.site.description],
    ["site.language", config.site.language],
    ["navigation.brandLabel", config.navigation.brandLabel],
    ["navigation.brandAccessibleLabel", config.navigation.brandAccessibleLabel],
    ["navigation.proofLabel", config.navigation.proofLabel],
    ["navigation.installLabel", config.navigation.installLabel],
    ["navigation.githubStarLabel", config.navigation.githubStarLabel],
    ["hero.id", config.hero.id],
    ["hero.eyebrow", config.hero.eyebrow],
    ["hero.heading", config.hero.heading],
    ["hero.body", config.hero.body],
    ["hero.primaryCtaLabel", config.hero.primaryCtaLabel],
    ["hero.secondaryCtaLabel", config.hero.secondaryCtaLabel],
    ["hero.logoAlt", config.hero.logoAlt],
    ["hero.outcomeTitle", config.hero.outcomeTitle],
    ["hero.outcomeBody", config.hero.outcomeBody],
    ["hero.outcomeStatus", config.hero.outcomeStatus],
    ["proof.id", config.proof.id],
    ["proof.heading", config.proof.heading],
    ["proof.body", config.proof.body],
    ["proof.accessibleDescription", config.proof.accessibleDescription],
    ["install.id", config.install.id],
    ["install.heading", config.install.heading],
    ["install.body", config.install.body],
    ["install.primaryInstallCmd", config.install.primaryInstallCmd],
    ["requirements.id", config.requirements.id],
    ["requirements.heading", config.requirements.heading],
    ["requirements.body", config.requirements.body],
    ["faq.id", config.faq.id],
    ["faq.heading", config.faq.heading],
    ["faq.body", config.faq.body],
    ["repository.owner", config.repository.owner],
    ["repository.name", config.repository.name],
    ["repository.url", config.repository.url],
    ["repository.star.loadingText", config.repository.star.loadingText],
    [
      "repository.star.loadingAccessibleLabel",
      config.repository.star.loadingAccessibleLabel,
    ],
    ["repository.star.fallbackText", config.repository.star.fallbackText],
    ["repository.star.accessibleLabel", config.repository.star.accessibleLabel],
    ["measurementNotes.id", config.measurementNotes.id],
    ["measurementNotes.heading", config.measurementNotes.heading],
    ["measurementNotes.body", config.measurementNotes.body],
  ];

  for (const [path, value] of requiredText) {
    if (value.trim().length === 0) {
      errors.push(`${path} must be non-empty.`);
    }
  }

  const verifiedRoutes = verifiedInstallRoutes(config);
  if (verifiedRoutes.length !== 1) {
    errors.push("install.commands must contain exactly one verified route.");
  }

  for (const [index, command] of config.install.commands.entries()) {
    for (const [field, value] of [
      ["label", command.label],
      ["command", command.command],
      ["copyCtaLabel", command.copyCtaLabel],
      ["shellCopyHint", command.shellCopyHint],
      ["verificationReference", command.verificationReference],
    ] as const) {
      if (value.trim().length === 0) {
        errors.push(`install.commands[${index}].${field} must be non-empty.`);
      }
    }
  }

  const commandIds = new Set(config.install.commands.map(({ id }) => id));
  if (commandIds.size !== config.install.commands.length) {
    errors.push("install.commands must not repeat a package-manager id.");
  }

  if (placeholderPattern.test(config.install.primaryInstallCmd)) {
    errors.push("install.primaryInstallCmd must not contain placeholders.");
  }

  if (
    verifiedRoutes.length === 1 &&
    verifiedRoutes[0]?.command !== config.install.primaryInstallCmd
  ) {
    errors.push(
      "install.primaryInstallCmd must match the sole verified route command.",
    );
  }

  const expectedRepoUrl = `https://github.com/${config.repository.owner}/${config.repository.name}`;
  if (config.repository.url !== expectedRepoUrl) {
    errors.push("repository.url must be derived from owner and name.");
  }

  if (config.proof.steps.length === 0) {
    errors.push("proof.steps must contain at least one proof cue.");
  }

  if (config.hero.benefits.length === 0) {
    errors.push("hero.benefits must contain at least one benefit.");
  }

  if (config.requirements.items.length === 0) {
    errors.push("requirements.items must contain at least one requirement.");
  }

  if (config.faq.items.length === 0) {
    errors.push("faq.items must contain at least one answer.");
  }

  return errors;
}

export function assertValidShowcaseConfig(
  config: ShowcaseConfig,
): asserts config is ShowcaseConfig {
  const errors = validateShowcaseConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid showcase config:\n- ${errors.join("\n- ")}`);
  }
}

function defineShowcaseConfig<const Config extends ShowcaseConfig>(
  config: Config,
): Config {
  assertValidShowcaseConfig(config);
  return config;
}

export const showcaseConfig = defineShowcaseConfig({
  site: {
    title: "Kitten — reviewed handoffs between Claude Code and Codex",
    description:
      "Move a live coding task between Claude Code and Codex through a bounded handoff you review before anything is sent.",
    language: "en",
  },
  navigation: {
    brandLabel: "Kitten",
    brandAccessibleLabel: "Kitten home",
    proofLabel: "How it works",
    installLabel: "Install",
    githubStarLabel: "Star on GitHub",
  },
  hero: {
    id: "hero",
    eyebrow: "A terminal cockpit for two coding agents",
    heading:
      "Keep every coding handoff reviewed and in context.",
    body:
      "Keep Claude Code and Codex live in one terminal, then hand over a task you can inspect, trim, confirm, or cancel.",
    primaryCtaLabel: "Install Kitten",
    secondaryCtaLabel: "See how it works",
    logoAlt:
      "Kitten logo: a golden cat holding a blue and teal loop between two agents.",
    outcomeTitle: "Review the handoff before the work moves.",
    outcomeBody:
      "The context bundle stays bounded and editable until you give the final confirmation.",
    outcomeStatus: "Review first",
    benefits: [
      "Review every context bundle before it moves.",
      "Keep both agent sessions live for a quick hand-back.",
      "Cancel any handoff before it reaches the other agent.",
    ],
  },
  proof: {
    id: "proof",
    heading: "See the handoff before it reaches the other agent.",
    body:
      "Three deliberate moments turn an easy-to-lose task switch into a reviewable path forward.",
    accessibleDescription:
      "A developer prepares a bounded handoff, reviews and trims its context, explicitly confirms it, and then watches the other agent continue the task.",
    steps: [
      {
        label: "Prepare",
        description:
          "Kitten assembles recent conversation context, touched files, and pending changes.",
      },
      {
        label: "Review and trim",
        description:
          "The developer inspects the redacted preview and edits or removes context before sending.",
      },
      {
        label: "Confirm and continue",
        description:
          "Only explicit confirmation sends the bundle; the receiving agent then continues the task.",
      },
    ],
  },
  install: {
    id: "install",
    heading: "Install Kitten with your package manager.",
    body:
      "Choose npm, pnpm, or Bun. Each route installs the published CLI and the matching macOS or Linux binary.",
    primaryInstallCmd,
    commands: [
      {
        id: "npm",
        label: "npm",
        command: primaryInstallCmd,
        source: installVerificationSource,
        copyCtaLabel: "Copy npm install command",
        shellCopyHint:
          "Copy this command into a terminal. It installs the Kitten CLI and the matching supported platform binary.",
        verificationReference: "npm:@matheusbbarni/kitten@0.3.0",
      },
      {
        id: "pnpm",
        label: "pnpm",
        command: `pnpm add --global ${npmPackageName}`,
        source: "supported-alternative",
        copyCtaLabel: "Copy pnpm install command",
        shellCopyHint:
          "Copy this command into a terminal. It installs the Kitten CLI globally with pnpm.",
        verificationReference: "pnpm.io/cli/add#global",
      },
      {
        id: "bun",
        label: "Bun",
        command: `bun install --global ${npmPackageName}`,
        source: "supported-alternative",
        copyCtaLabel: "Copy Bun install command",
        shellCopyHint:
          "Copy this command into a terminal. It installs the Kitten CLI globally with Bun.",
        verificationReference: "bun.sh/docs/pm/cli/install#global-installs",
      },
    ],
  },
  requirements: {
    id: "requirements",
    heading: "What you need",
    body:
      "Kitten uses your existing coding-agent installations and runs from inside a Git repository.",
    items: [
      "npm, pnpm, or Bun for the published installation route.",
      "Claude Code and Codex installed and authenticated.",
      "A Git repository to launch Kitten from.",
    ],
  },
  faq: {
    id: "faq",
    heading: "Questions before you try it",
    body:
      "The short version of Kitten's scope, control boundary, and fallback behavior.",
    items: [
      {
        question: "What moves between agents?",
        answer:
          "A bounded bundle of recent conversation context, touched files, and pending changes — not every piece of task history.",
      },
      {
        question: "Does Kitten send anything automatically?",
        answer:
          "No. The handoff opens in a preview where you can edit, trim, confirm, or cancel it. Only confirmation sends it.",
      },
      {
        question: "Does redaction replace human review?",
        answer:
          "No. Kitten redacts recognized secrets before preview, and your review remains the final safeguard before sending.",
      },
      {
        question: "What happens if one agent is unavailable?",
        answer:
          "Kitten marks that agent unavailable and leaves the other usable instead of taking down the cockpit.",
      },
      {
        question: "Does the showcase track visitors?",
        answer:
          "V1 emits no automatic website analytics. Kitten's application telemetry is separate, local, content-free, opt-in, and off by default.",
      },
    ],
  },
  repository: {
    owner: repoOwner,
    name: repoName,
    url: repositoryUrl,
    star: {
      loadingText: "…",
      loadingAccessibleLabel:
        "Star Kitten on GitHub. The live star count is loading.",
      fallbackText: "—",
      accessibleLabel:
        "Star Kitten on GitHub. The live star count is currently unavailable.",
    },
  },
  measurementNotes: {
    id: "measurement",
    heading: "No automatic site telemetry in V1",
    body:
      "The showcase uses no cookies, persistent identifiers, fingerprints, or behavioral analytics scripts.",
  },
} satisfies ShowcaseConfig);

export const { hero, proof, requirements, faq } = showcaseConfig;
