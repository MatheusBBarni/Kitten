# Syntax asset provenance

The Markdown assets in this directory were vendored byte-for-byte from the
exact-pinned `@opentui/core` npm package at version `0.4.3`. The Rust, Go,
OCaml, JSON, and Bash assets were vendored byte-for-byte from the official
grammar npm packages `tree-sitter-rust@0.24.0`, `tree-sitter-go@0.25.0`,
`tree-sitter-ocaml@0.24.2`, `tree-sitter-json@0.24.8`, and
`tree-sitter-bash@0.25.1`. Kitten owns these copies so its parser manifest uses
public registration APIs and static file imports without reaching into package
paths at runtime.

Upstream repository: <https://github.com/anomalyco/opentui/tree/main/packages/core>

Grammar repositories:

- <https://github.com/tree-sitter/tree-sitter-rust/tree/v0.24.0>
- <https://github.com/tree-sitter/tree-sitter-go/tree/v0.25.0>
- <https://github.com/tree-sitter/tree-sitter-ocaml/tree/v0.24.2>
- <https://github.com/tree-sitter/tree-sitter-json/tree/v0.24.8>
- <https://github.com/tree-sitter/tree-sitter-bash/tree/v0.25.1>

ReScript remains a declared plaintext fallback rather than a highlighted
capability. The official `rescript-lang/tree-sitter-rescript` v6.0.0 release
contains an MIT-licensed grammar and highlight query, but publishes no npm or
GitHub-release WASM asset. Without a versioned upstream binary to review and
vendor, it does not meet Kitten's local-asset provenance gate.

The accompanying `LICENSE.*` files are the licenses distributed with each
source package. Query files retain their embedded upstream attribution comments.

Reviewed on 2026-07-14 against the installed package and its current default
Markdown parser configuration. SHA-256 checksums:

```text
f3b02df1a9213cfecfb6936bce8db2f777edd523fc23ed890695e6cb4552d556  markdown/highlights.scm
a2bf8c052454acbe765970a4ad2706c60cad7b62a762b927e28f60af1a0ef516  markdown/injections.scm
3e13182f21373634c40653f170e6f2d2790914eb2c243927086d79023c534f7a  markdown/tree-sitter-markdown.wasm
ca9a109ddd21c5ffdc6b84f00c0a4b2eeb55ae36a0b8eeb9b02348269c5acd22  markdown_inline/highlights.scm
9bbd71a70a23f6d0193bb162a72eecf2a2bd9ce76910d7ad3da9c5f80f122671  markdown_inline/tree-sitter-markdown_inline.wasm
0f0343107f14a7690157f51090a979eb8f8bfe4eada7c61763ddb4c54b1311d1  rust/highlights.scm
f65f354215611fd94ad34134b3427eb3d58cbb745df7b6509ba722184db73d57  rust/tree-sitter-rust.wasm
81182c986547eba7fa6316e82dfd621fb13b8fc89efac85432aee51a48ed0896  go/highlights.scm
9504573f352b20be7f2f1911754d710622aedc15afff16d5ed8fb5645681aee7  go/tree-sitter-go.wasm
9bdabb038c60c159cef48f4d9f775bdd951230190dd7721da9aaea073a2c8cce  ocaml/highlights.scm
761a78a804931cfac1fa0c6238989b4b0e86cc70db461b1315d743de923f8246  ocaml/tree-sitter-ocaml.wasm
0511524465b56aed122580792254e68b6abbbfde7119f1d02b135acbe278233f  json/highlights.scm
d2119fb98d5912719b13f9458574f8608d2d29dfbe45f6be1f860ea1fe2a2405  json/tree-sitter-json.wasm
b74220d954f485b7626d2b2b61f37b522e12eb1830803e388e57dd797dc99f11  bash/highlights.scm
8292919c88a0f7d3fb31d0cd0253ca5a9531bc1ede82b0537f2c63dd8abe6a7a  bash/tree-sitter-bash.wasm
```
