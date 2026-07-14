# Syntax asset provenance

The Markdown assets in this directory were vendored byte-for-byte from the
exact-pinned `@opentui/core` npm package at version `0.4.3`. Kitten owns these
copies so its Markdown parser override uses public registration APIs and static
file imports without reaching into unexported package paths at runtime.

Upstream repository: <https://github.com/anomalyco/opentui/tree/main/packages/core>

The accompanying `LICENSE.opentui` is the MIT license distributed with that
package. Query files retain their embedded upstream attribution comments.

Reviewed on 2026-07-14 against the installed package and its current default
Markdown parser configuration. SHA-256 checksums:

```text
f3b02df1a9213cfecfb6936bce8db2f777edd523fc23ed890695e6cb4552d556  markdown/highlights.scm
a2bf8c052454acbe765970a4ad2706c60cad7b62a762b927e28f60af1a0ef516  markdown/injections.scm
3e13182f21373634c40653f170e6f2d2790914eb2c243927086d79023c534f7a  markdown/tree-sitter-markdown.wasm
ca9a109ddd21c5ffdc6b84f00c0a4b2eeb55ae36a0b8eeb9b02348269c5acd22  markdown_inline/highlights.scm
9bbd71a70a23f6d0193bb162a72eecf2a2bd9ce76910d7ad3da9c5f80f122671  markdown_inline/tree-sitter-markdown_inline.wasm
```
