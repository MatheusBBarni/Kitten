#!/usr/bin/env bash
#
# Kitten installer (ADR-006).
#
# One-line install:
#   curl -fsSL https://raw.githubusercontent.com/OWNER/kitten/main/scripts/install.sh | bash
#
# Downloads the standalone binary for the current platform plus the SHA256SUMS
# manifest, verifies the binary's checksum against the manifest, and only then
# installs it. A checksum mismatch aborts before anything is written to PATH: a
# corrupted or tampered download must never be executed.
#
# Overridable via environment:
#   KITTEN_VERSION       release tag to install (default: latest)
#   KITTEN_INSTALL_DIR   install destination   (default: $HOME/.local/bin)
#   KITTEN_BASE_URL      release download base  (default: GitHub releases)
#   KITTEN_PLATFORM      platform slug override (default: detected)

set -euo pipefail

REPO="${KITTEN_REPO:-OWNER/kitten}"
VERSION="${KITTEN_VERSION:-latest}"
INSTALL_DIR="${KITTEN_INSTALL_DIR:-$HOME/.local/bin}"

# Detect the platform slug used in the artifact name (matches scripts/build.ts).
detect_platform() {
  if [ -n "${KITTEN_PLATFORM:-}" ]; then
    printf '%s' "$KITTEN_PLATFORM"
    return 0
  fi

  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *)
      echo "kitten: unsupported OS '$os'. Supported: Darwin, Linux." >&2
      return 1
      ;;
  esac

  case "$arch" in
    arm64 | aarch64) arch="arm64" ;;
    x86_64 | amd64) arch="x64" ;;
    *)
      echo "kitten: unsupported architecture '$arch'. Supported: arm64, x64." >&2
      return 1
      ;;
  esac

  printf '%s-%s' "$os" "$arch"
}

# Compute the SHA-256 of a file, portable across sha256sum (Linux) and
# shasum (macOS). Prints the lowercase hex digest only.
compute_sha256() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    echo "kitten: need sha256sum or shasum to verify the download." >&2
    return 1
  fi
}

# Verify a file against an expected checksum. Returns non-zero on any mismatch,
# an empty expected value, or a missing file - the caller must not install on failure.
verify_checksum() {
  local file="$1" expected="$2" actual
  if [ ! -f "$file" ]; then
    echo "kitten: cannot verify '$file': file not found." >&2
    return 1
  fi
  if [ -z "$expected" ]; then
    echo "kitten: no expected checksum for '$file'; refusing to install." >&2
    return 1
  fi
  actual="$(compute_sha256 "$file")"
  if [ "$actual" != "$expected" ]; then
    echo "kitten: checksum mismatch for '$file'." >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    return 1
  fi
  return 0
}

# Extract the expected checksum for an artifact from a SHA256SUMS manifest.
# Manifest lines are "<hex>  <name>"; prints the hex for the matching name.
checksum_for() {
  local manifest="$1" name="$2"
  awk -v n="$name" '$2 == n {print $1; found=1} END {exit found ? 0 : 1}' "$manifest"
}

main() {
  local platform artifact base tmp bin_path manifest_path expected
  platform="$(detect_platform)"
  artifact="kitten-${platform}"

  if [ -n "${KITTEN_BASE_URL:-}" ]; then
    base="$KITTEN_BASE_URL"
  elif [ "$VERSION" = "latest" ]; then
    base="https://github.com/${REPO}/releases/latest/download"
  else
    base="https://github.com/${REPO}/releases/download/${VERSION}"
  fi

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  bin_path="${tmp}/${artifact}"
  manifest_path="${tmp}/SHA256SUMS"

  echo "kitten: downloading ${artifact} from ${base}" >&2
  curl -fsSL "${base}/${artifact}" -o "$bin_path"
  curl -fsSL "${base}/SHA256SUMS" -o "$manifest_path"

  expected="$(checksum_for "$manifest_path" "$artifact" || true)"
  verify_checksum "$bin_path" "$expected"

  mkdir -p "$INSTALL_DIR"
  install -m 755 "$bin_path" "${INSTALL_DIR}/kitten"
  echo "kitten: installed to ${INSTALL_DIR}/kitten" >&2
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *) echo "kitten: add ${INSTALL_DIR} to your PATH to run 'kitten'." >&2 ;;
  esac
}

# Only run the installer when executed directly, so tests can source the file and
# exercise verify_checksum / detect_platform in isolation.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
