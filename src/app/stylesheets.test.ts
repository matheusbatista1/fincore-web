import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));

function stylesheetsUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return stylesheetsUnder(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

describe("stylesheets", () => {
  // The bundler concatenates every stylesheet into one file and (since postcss 8.5.26) no
  // longer drops a leading byte-order mark. Mid-bundle, U+FEFF parses as a type selector, so
  // the first rule of that file silently dies: `.shell` lost its grid in #173.
  it("carry no byte-order mark", () => {
    const files = stylesheetsUnder(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const firstCodeUnit = readFileSync(file, "utf8").charCodeAt(0);
      expect(firstCodeUnit, `${relative(SRC_DIR, file)} starts with a BOM`).not.toBe(0xfeff);
    }
  });
});
