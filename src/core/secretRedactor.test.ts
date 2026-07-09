import { describe, expect, it } from "bun:test"

import { REDACTION_PLACEHOLDER, createSecretRedactor, defaultSecretPatterns } from "./secretRedactor.ts"

/**
 * The redactor is pure, so every case is a plain string in / string out check.
 * The two properties that matter for the hand-off: no covered secret survives,
 * and the surrounding text (especially a unified diff) is left structurally
 * intact so the receiving agent can still read it.
 */

const redactor = createSecretRedactor()
const R = REDACTION_PLACEHOLDER

/** Fixture credentials. All fake, all shaped like the real thing. */
const ANTHROPIC_KEY = "sk-ant-api03-A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0"
const OPENAI_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD"
const GITHUB_TOKEN = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
const AWS_KEY_ID = "AKIAIOSFODNN7EXAMPLE"
const GOOGLE_KEY = "AIzaSyD-1234567890abcdefghijklmnopqrstu"
const SLACK_TOKEN = "xoxb-123456789012-abcdefghijklmnop"
const STRIPE_KEY = "sk_live_51A1b2C3d4E5f6G7h8I9j0K1l2"
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"

describe("createSecretRedactor", () => {
  it("returns empty text with no redactions for an empty string", () => {
    expect(redactor.redact("")).toEqual({ text: "", count: 0 })
  })

  it("leaves ordinary prose untouched", () => {
    const prose = "I read src/parser.ts and the tokenizer looks fine, but the lexer drops newlines."
    expect(redactor.redact(prose)).toEqual({ text: prose, count: 0 })
  })

  it("does not redact a prose value that has no digit", () => {
    const prose = "Pass the token: something-descriptive-here"
    expect(redactor.redact(prose)).toEqual({ text: prose, count: 0 })
  })

  it("does not redact a short assignment value", () => {
    const prose = "password = short12"
    expect(redactor.redact(prose)).toEqual({ text: prose, count: 0 })
  })
})

describe("vendor credential shapes", () => {
  const cases: [name: string, secret: string][] = [
    ["anthropic key", ANTHROPIC_KEY],
    ["openai key", OPENAI_KEY],
    ["github token", GITHUB_TOKEN],
    ["github fine-grained token", "github_pat_11ABCDEFG0abcdefghijkl_MNOPQRSTUVWXYZ0123456789"],
    ["aws access key id", AWS_KEY_ID],
    ["google api key", GOOGLE_KEY],
    ["slack token", SLACK_TOKEN],
    ["stripe key", STRIPE_KEY],
    ["jwt", JWT],
  ]

  it.each(cases)("redacts an %s and counts it once", (_name, secret) => {
    const result = redactor.redact(`the value is ${secret} ok`)
    expect(result.text).toBe(`the value is ${R} ok`)
    expect(result.count).toBe(1)
  })
})

describe("partial redaction", () => {
  it("keeps the auth scheme and drops only the credential", () => {
    const result = redactor.redact("Authorization: Bearer abcdef0123456789abcdef")
    expect(result.text).toBe(`Authorization: Bearer ${R}`)
    expect(result.count).toBe(1)
  })

  it("keeps the variable name and drops only the assigned value", () => {
    const result = redactor.redact('const API_KEY = "abcdef123456789"')
    expect(result.text).toBe(`const API_KEY = "${R}"`)
    expect(result.count).toBe(1)
  })

  it("handles an unquoted env-style assignment", () => {
    const result = redactor.redact("DATABASE_PASSWORD=hunter2iscorrect99")
    expect(result.text).toBe(`DATABASE_PASSWORD=${R}`)
    expect(result.count).toBe(1)
  })
})

describe("counting", () => {
  it("counts each distinct secret on the same line", () => {
    const result = redactor.redact(`${ANTHROPIC_KEY} and ${GITHUB_TOKEN}`)
    expect(result.text).toBe(`${R} and ${R}`)
    expect(result.count).toBe(2)
  })

  it("counts secrets across multiple lines and preserves the line structure", () => {
    const result = redactor.redact(`first ${AWS_KEY_ID}\n\nlast ${STRIPE_KEY}`)
    expect(result.text).toBe(`first ${R}\n\nlast ${R}`)
    expect(result.count).toBe(2)
  })

  it("counts an overlapping vendor key and assignment only once", () => {
    const result = redactor.redact(`ANTHROPIC_API_KEY=${ANTHROPIC_KEY}`)
    expect(result.text).toBe(`ANTHROPIC_API_KEY=${R}`)
    expect(result.count).toBe(1)
  })

  it("is idempotent: a second pass finds nothing left to redact", () => {
    const once = redactor.redact(`key ${OPENAI_KEY} and ${JWT}`)
    const twice = redactor.redact(once.text)
    expect(twice.text).toBe(once.text)
    expect(twice.count).toBe(0)
  })

  it("does not leak a regex lastIndex between calls", () => {
    const line = `token ${GITHUB_TOKEN}`
    expect(redactor.redact(line).count).toBe(1)
    expect(redactor.redact(line).count).toBe(1)
  })
})

describe("unified diffs", () => {
  it("redacts a secret inside a hunk without corrupting the diff", () => {
    const diff = [
      "--- a/src/client.ts",
      "+++ b/src/client.ts",
      "@@ -1,3 +1,4 @@",
      " import { Client } from './client'",
      "-const key = process.env.ANTHROPIC_API_KEY",
      `+const key = "${ANTHROPIC_KEY}"`,
      " export const client = new Client(key)",
    ].join("\n")

    const result = redactor.redact(diff)

    expect(result.count).toBe(1)
    expect(result.text).not.toContain(ANTHROPIC_KEY)
    expect(result.text.split("\n")).toEqual([
      "--- a/src/client.ts",
      "+++ b/src/client.ts",
      "@@ -1,3 +1,4 @@",
      " import { Client } from './client'",
      "-const key = process.env.ANTHROPIC_API_KEY",
      `+const key = "${R}"`,
      " export const client = new Client(key)",
    ])
  })

  it("keeps every line prefix and the hunk header intact", () => {
    const diff = `@@ -1 +1 @@\n-old\n+${STRIPE_KEY}`
    const lines = redactor.redact(diff).text.split("\n")
    expect(lines[0]).toBe("@@ -1 +1 @@")
    expect(lines[1]).toBe("-old")
    expect(lines[2]).toBe(`+${R}`)
  })
})

describe("PEM private key blocks", () => {
  const pem = [
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEowIBAAKCAQEAvB1s2Q9nJ8mK3pLxR7tYuI0oP2aS4dF6gH8jK0lM2nO4pQ6r",
    "S8tU0vW2xY4zA6bC8dE0fG2hI4jK6lM8nO0pQ2rS4tU6vW8xY0zA2bC4dE6fG8hI",
    "-----END RSA PRIVATE KEY-----",
  ].join("\n")

  it("masks the key body, keeps the markers, and counts the block once", () => {
    const result = redactor.redact(pem)
    expect(result.count).toBe(1)
    expect(result.text.split("\n")).toEqual([
      "-----BEGIN RSA PRIVATE KEY-----",
      R,
      R,
      "-----END RSA PRIVATE KEY-----",
    ])
  })

  it("preserves diff prefixes when a key block is added in a hunk", () => {
    const diff = pem
      .split("\n")
      .map((line) => `+${line}`)
      .join("\n")
    const result = redactor.redact(`@@ -0,0 +1,4 @@\n${diff}`)
    expect(result.count).toBe(1)
    expect(result.text.split("\n")).toEqual([
      "@@ -0,0 +1,4 @@",
      "+-----BEGIN RSA PRIVATE KEY-----",
      `+${R}`,
      `+${R}`,
      "+-----END RSA PRIVATE KEY-----",
    ])
  })

  it("masks to the end of the text when the block is never closed", () => {
    const result = redactor.redact("-----BEGIN PRIVATE KEY-----\nMIIEowIBAAKCAQEAvB1s2Q9\nstill secret")
    expect(result.text).toBe(`-----BEGIN PRIVATE KEY-----\n${R}\n${R}`)
    expect(result.count).toBe(1)
  })

  it("leaves blank lines inside a block alone", () => {
    const result = redactor.redact("-----BEGIN PRIVATE KEY-----\n\n-----END PRIVATE KEY-----")
    expect(result.text).toBe("-----BEGIN PRIVATE KEY-----\n\n-----END PRIVATE KEY-----")
  })

  it("keeps the diff marker on a blank body line inside a block", () => {
    // A prefix-only line must not lose its `+` to the placeholder.
    const result = redactor.redact("+-----BEGIN PRIVATE KEY-----\n+   \n+-----END PRIVATE KEY-----")
    expect(result.text.split("\n")[1]).toBe("+   ")
  })

  it("masks a removed key body, whose diff marker doubles the leading dashes", () => {
    const result = redactor.redact("------BEGIN PRIVATE KEY-----\n-MIIEowIBAAKCAQEAvB1s\n------END PRIVATE KEY-----")
    expect(result.text.split("\n")).toEqual([
      "------BEGIN PRIVATE KEY-----",
      `-${R}`,
      "------END PRIVATE KEY-----",
    ])
    expect(result.count).toBe(1)
  })
})

describe("custom patterns", () => {
  it("uses only the patterns it is given", () => {
    const narrow = createSecretRedactor([{ name: "internal", regex: /\bINTERNAL-[0-9]{4}\b/g }])
    const result = narrow.redact(`INTERNAL-1234 alongside ${ANTHROPIC_KEY}`)
    expect(result.text).toBe(`${R} alongside ${ANTHROPIC_KEY}`)
    expect(result.count).toBe(1)
  })

  it("makes a non-global pattern global so it catches every occurrence on a line", () => {
    const narrow = createSecretRedactor([{ name: "internal", regex: /INTERNAL-[0-9]{4}/ }])
    const result = narrow.redact("INTERNAL-1234 then INTERNAL-5678")
    expect(result.text).toBe(`${R} then ${R}`)
    expect(result.count).toBe(2)
  })

  it("exposes a fresh default pattern list on every call", () => {
    expect(defaultSecretPatterns()).not.toBe(defaultSecretPatterns())
    expect(defaultSecretPatterns().length).toBeGreaterThan(0)
  })
})
