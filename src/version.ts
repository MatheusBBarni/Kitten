import pkg from "../package.json" with { type: "json" }

/** Kitten's release version; release-please updates the package.json source. */
export const KITTEN_VERSION: string = pkg.version
