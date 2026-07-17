export const configDocs = {
  site: {
    title: "Kitten configuration reference",
    description:
      "Create a valid Kitten config.json, choose local coding-agent sessions, and set the preferences that apply to your cockpit.",
    language: "en",
  },
  hero: {
    eyebrow: "Configuration",
    heading: "Configure Kitten without guessing.",
    body:
      "Start with a small JSON delta, then add providers, sessions, preferences, and local MCP servers when you need them.",
  },
  topics: [
    { id: "config-location", label: "File location" },
    { id: "sessions", label: "Sessions" },
    { id: "providers", label: "Providers" },
    { id: "preferences", label: "Preferences" },
    { id: "mcp-and-tools", label: "MCP and tools" },
    { id: "reloads-and-errors", label: "Reloads and errors" },
  ],
  starterConfig: `{
  "theme": "dark",
  "sessions": [
    { "provider": "codex", "cwd": ".", "title": "Implementation" },
    { "provider": "claude-code", "cwd": ".", "title": "Review" },
    { "provider": "cursor", "cwd": ".", "title": "Explore" }
  ]
}`,
  providerConfig: `{
  "providers": {
    "codex": {
      "displayName": "Codex implementation",
      "env": {
        "INITIAL_AGENT_MODE": "agent-full-access"
      }
    }
  },
  "providerDefaults": {
    "codex": { "model": "gpt-5.4", "effort": "high" },
    "claude-code": { "model": "claude-opus-4-1", "effort": "high" }
  }
}`,
  mcpConfig: `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "\${GITHUB_TOKEN}"
      }
    }
  }
}`,
  editorConfig: `{
  "editor": {
    "kind": "custom",
    "executable": "code",
    "args": ["--goto", "{file}"]
  },
  "shell": {
    "enabled": true,
    "scrollback": 5000
  }
}`,
} as const;
