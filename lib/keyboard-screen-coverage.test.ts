import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(process.cwd(), "app");
const routeFilePattern = /\.(tsx|jsx)$/;

function listRouteFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .flatMap((entry) => {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) return listRouteFiles(fullPath);
      return routeFilePattern.test(entry) ? [fullPath] : [];
    })
    .sort();
}

describe("keyboard-aware app forms", () => {
  it("wraps every app route with TextInput in KeyboardScreen", () => {
    const uncovered = listRouteFiles(appRoot)
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return /\bTextInput\b/.test(source) && !/<KeyboardScreen\b/.test(source);
      })
      .map((file) => relative(process.cwd(), file));

    expect(uncovered).toEqual([]);
  });
});
