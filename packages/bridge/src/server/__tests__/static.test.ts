/**
 * Tests that every module the PWA imports is embedded for compiled builds.
 *
 * Dev mode serves static files from disk, so a JS module missing from
 * EMBEDDED_FILES still loads in dev — but a compiled binary only serves
 * what is embedded, and a missing import is a 404 that fails the app
 * load. This test reads app.js's imports and asserts each one is embedded.
 * (brightness-activity.js was missing until this test was added.)
 */

import { describe, expect, test } from "bun:test";

import { EMBEDDED_FILES } from "../static";

describe("EMBEDDED_FILES", () => {
  test("embeds every module app.js imports", async () => {
    const appJs = await Bun.file(new URL("../../../../web/js/app.js", import.meta.url)).text();
    // Relative imports of the form: import ... from "./<name>.js";
    const imports = [...appJs.matchAll(/from\s+"(\.\/[^\"]+\.js)"/g)]
      .map((m) => m[1])
      .filter((spec): spec is string => spec !== undefined);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      const urlPath = `/js/${spec.slice(2)}`;
      expect(Object.hasOwn(EMBEDDED_FILES, urlPath)).toBe(true);
    }
  });

  test("embeds every file index.html loads", async () => {
    const indexHtml = await Bun.file(new URL("../../../../web/index.html", import.meta.url)).text();
    // Local stylesheet and script references (not the CDN script).
    const localRefs = [...indexHtml.matchAll(/(?:href|src)="((?:css|js)\/[^\"]+)"/g)]
      .map((m) => m[1])
      .filter((ref): ref is string => ref !== undefined)
      .map((ref) => `/${ref}`);
    expect(localRefs.length).toBeGreaterThan(0);
    for (const urlPath of localRefs) {
      expect(Object.hasOwn(EMBEDDED_FILES, urlPath)).toBe(true);
    }
  });
});
