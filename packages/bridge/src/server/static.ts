/**
 * Static File Server
 *
 * Serves static files from the web package.
 * Works both in development (reads from filesystem) and
 * production (embedded in the compiled binary).
 *
 * Uses Bun's file embedding feature for compiled binaries:
 * - In dev: files are read from disk
 * - In compiled binary: files are embedded and served from $bunfs/
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import styleCssPath from "../../../web/css/style.css" with { type: "file" };
import iconSvgPath from "../../../web/icons/icon.svg" with { type: "file" };
// Embed web files for compiled binary support
// These imports return paths that work both in dev and compiled modes
// In dev: returns filesystem path like "/path/to/web/index.html"
// In compiled: returns embedded path like "$bunfs/index-abc123.html"
import indexHtmlPath from "../../../web/index.html" with { type: "file" };
import apiJsPath from "../../../web/js/api.js" with { type: "file" };
import appJsPath from "../../../web/js/app.js" with { type: "file" };
import setupModeJsPath from "../../../web/js/setup-mode.js" with { type: "file" };
import cryptoJsPath from "../../../web/js/vendor/crypto-js.min.js" with { type: "file" };
import manifestJsonPath from "../../../web/manifest.json" with { type: "file" };
import swJsPath from "../../../web/sw.js" with { type: "file" };

/**
 * Mapping of URL paths to embedded file paths.
 */
const EMBEDDED_FILES: Record<string, string> = {
  "/index.html": String(indexHtmlPath),
  "/css/style.css": String(styleCssPath),
  "/js/app.js": String(appJsPath),
  "/js/api.js": String(apiJsPath),
  "/js/setup-mode.js": String(setupModeJsPath),
  "/js/vendor/crypto-js.min.js": String(cryptoJsPath),
  "/sw.js": String(swJsPath),
  "/manifest.json": String(manifestJsonPath),
  "/icons/icon.svg": String(iconSvgPath),
};

/**
 * MIME types for common file extensions.
 */
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
};

/**
 * Gets the MIME type for a file extension.
 */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Cache for static files (populated at startup).
 */
const fileCache = new Map<string, { content: Uint8Array; mimeType: string }>();

/**
 * Detects if we're running as a compiled binary.
 * Compiled binaries have import.meta.dir containing "$bunfs" (may be "/$bunfs" or "$bunfs")
 */
export function isCompiledBinary(): boolean {
  return import.meta.dir.includes("$bunfs");
}

/**
 * Detects if we're running in development mode.
 */
export function isDevMode(): boolean {
  return !isCompiledBinary();
}

/**
 * Gets the web directory path for development mode.
 */
function getWebDir(): string {
  // In development: relative to bridge package
  const devPath = resolve(import.meta.dir, "../../../web");
  if (existsSync(devPath)) {
    return devPath;
  }

  // Fallback: try current working directory
  const cwdPath = resolve(process.cwd(), "packages/web");
  if (existsSync(cwdPath)) {
    return cwdPath;
  }

  console.warn("[Static] Web directory not found");
  return devPath;
}

/**
 * Recursively reads all files from a directory (development mode).
 */
function readFilesRecursively(dir: string, basePath = ""): void {
  if (!existsSync(dir)) {
    console.warn(`[Static] Directory not found: ${dir}`);
    return;
  }

  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const relativePath = basePath ? `${basePath}/${entry}` : entry;
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      readFilesRecursively(fullPath, relativePath);
    } else if (stat.isFile()) {
      try {
        // Use Bun.file for reading - works with both filesystem and embedded paths
        const file = Bun.file(fullPath);
        const content = new Uint8Array(file.stream() as unknown as ArrayBuffer);
        const mimeType = getMimeType(entry);
        fileCache.set(`/${relativePath}`, {
          content,
          mimeType,
        });
      } catch (error) {
        console.warn(`[Static] Failed to read file: ${relativePath}`, error);
      }
    }
  }
}

/**
 * Loads embedded files (production/compiled mode).
 * Uses Bun.file() which works with both filesystem and $bunfs/ paths.
 */
async function loadEmbeddedFiles(): Promise<void> {
  for (const [urlPath, filePath] of Object.entries(EMBEDDED_FILES)) {
    try {
      const file = Bun.file(filePath);
      const arrayBuffer = await file.arrayBuffer();
      const content = new Uint8Array(arrayBuffer);
      const mimeType = getMimeType(urlPath);
      fileCache.set(urlPath, { content, mimeType });
    } catch (error) {
      console.warn(`[Static] Failed to load embedded file: ${urlPath} from ${filePath}`, error);
    }
  }
}

/**
 * Loads files from filesystem (development mode).
 */
async function loadFilesystemFiles(): Promise<void> {
  const webDir = getWebDir();
  console.log(`[Static] Loading static files from: ${webDir}`);

  if (!existsSync(webDir)) {
    console.warn(`[Static] Directory not found: ${webDir}`);
    return;
  }

  // Recursively load all files
  async function loadDir(dir: string, basePath = ""): Promise<void> {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const relativePath = basePath ? `${basePath}/${entry}` : entry;
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        await loadDir(fullPath, relativePath);
      } else if (stat.isFile()) {
        try {
          const file = Bun.file(fullPath);
          const arrayBuffer = await file.arrayBuffer();
          const content = new Uint8Array(arrayBuffer);
          const mimeType = getMimeType(entry);
          fileCache.set(`/${relativePath}`, { content, mimeType });
        } catch (error) {
          console.warn(`[Static] Failed to read file: ${relativePath}`, error);
        }
      }
    }
  }

  await loadDir(webDir);
}

/**
 * Initializes the static file cache.
 * Call this at startup to pre-load all static files.
 */
export async function initStaticFiles(): Promise<void> {
  fileCache.clear();

  if (isCompiledBinary()) {
    console.log("[Static] Loading embedded static files (compiled binary mode)");
    await loadEmbeddedFiles();
  } else {
    await loadFilesystemFiles();
  }

  // Also cache root as /index.html
  const indexFile = fileCache.get("/index.html");
  if (indexFile) {
    fileCache.set("/", indexFile);
  }

  console.log(`[Static] Loaded ${fileCache.size} static files`);
}

/**
 * Gets a static file from the cache.
 */
export function getStaticFile(path: string): { content: Uint8Array; mimeType: string } | null {
  // Normalize path
  let normalizedPath = path;
  if (!normalizedPath.startsWith("/")) {
    normalizedPath = `/${normalizedPath}`;
  }

  // Check cache
  const cached = fileCache.get(normalizedPath);
  if (cached) {
    return cached;
  }

  // For SPA routing: if not found and not an API route, return index.html
  if (!normalizedPath.startsWith("/api") && !normalizedPath.includes(".")) {
    return fileCache.get("/index.html") ?? null;
  }

  return null;
}

/**
 * Creates a Hono middleware for serving static files.
 * In development mode, files are read fresh from disk on each request.
 * In production, files are served from the pre-loaded cache.
 */
export function staticFileMiddleware() {
  const isDev = !isCompiledBinary();
  const webDir = isDev ? getWebDir() : "";

  return async (c: { req: { path: string } }, next: () => Promise<void>) => {
    const path = c.req.path;

    // Skip API routes
    if (path.startsWith("/api")) {
      return next();
    }

    // Skip special routes that are handled by other middleware
    if (path === "/qr" || path === "/welcome") {
      return next();
    }

    // In development mode, read files fresh from disk (no caching)
    if (isDev) {
      const file = await getStaticFileFresh(webDir, path);
      if (file) {
        let content: Uint8Array | string = file.content;
        if (file.mimeType.startsWith("text/html")) {
          const html = new TextDecoder().decode(file.content);
          content = new TextEncoder().encode(
            html.replace("<head>", "<head><script>window.__DEV__=true</script>")
          );
        }
        return new Response(content, {
          headers: {
            "Content-Type": file.mimeType,
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          },
        });
      }
    } else {
      // Production: serve from pre-loaded cache
      const file = getStaticFile(path);
      if (file) {
        return new Response(file.content, {
          headers: {
            "Content-Type": file.mimeType,
            "Cache-Control": "public, max-age=3600",
          },
        });
      }
    }

    return next();
  };
}

/**
 * Reads a static file fresh from disk (for development mode).
 */
async function getStaticFileFresh(
  webDir: string,
  path: string
): Promise<{ content: Uint8Array; mimeType: string } | null> {
  // Normalize path
  let normalizedPath = path;
  if (!normalizedPath.startsWith("/")) {
    normalizedPath = `/${normalizedPath}`;
  }

  // Handle root path
  if (normalizedPath === "/") {
    normalizedPath = "/index.html";
  }

  // Construct full file path
  const fullPath = join(webDir, normalizedPath);

  // Security: prevent directory traversal
  if (!fullPath.startsWith(webDir)) {
    return null;
  }

  try {
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      // For SPA routing: if not found and not a file extension, return index.html
      if (!normalizedPath.startsWith("/api") && !normalizedPath.includes(".")) {
        const indexPath = join(webDir, "index.html");
        if (existsSync(indexPath)) {
          const file = Bun.file(indexPath);
          const arrayBuffer = await file.arrayBuffer();
          return {
            content: new Uint8Array(arrayBuffer),
            mimeType: "text/html; charset=utf-8",
          };
        }
      }
      return null;
    }

    const file = Bun.file(fullPath);
    const arrayBuffer = await file.arrayBuffer();
    return {
      content: new Uint8Array(arrayBuffer),
      mimeType: getMimeType(fullPath),
    };
  } catch {
    return null;
  }
}

/**
 * Checks if static files are initialized.
 */
export function isStaticFilesInitialized(): boolean {
  return fileCache.size > 0;
}

/**
 * Gets the number of cached files.
 */
export function getCachedFileCount(): number {
  return fileCache.size;
}
