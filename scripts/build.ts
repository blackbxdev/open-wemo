#!/usr/bin/env bun
/**
 * Build Script for Open Wemo
 *
 * Builds standalone executables for Windows, macOS, and Linux.
 * Generates checksums and creates distribution archives.
 *
 * Usage:
 *   bun scripts/build.ts [platform]
 *
 * Platforms: windows, mac, mac-intel, linux, all
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { $ } from "bun";

// Configuration
const ROOT_DIR = resolve(import.meta.dir, "..");
const BRIDGE_DIR = join(ROOT_DIR, "packages/bridge");
const DIST_DIR = join(BRIDGE_DIR, "dist");

// Get version from package.json
const packageJson = JSON.parse(readFileSync(join(BRIDGE_DIR, "package.json"), "utf-8"));
const VERSION = packageJson.version || "0.1.0";

// Platform configurations
interface PlatformConfig {
  target: string;
  outputName: string;
  archiveName: string;
  extraFlags?: string[];
}

// Windows icon path (relative to BRIDGE_DIR since we run bun build from there)
const WINDOWS_ICON = "assets/icon.ico";

/**
 * Finds the Visual Studio editbin.exe tool.
 * Used to patch Windows executables to hide console window.
 */
function findEditBin(): string | null {
  const vsBasePaths = [
    "C:/Program Files/Microsoft Visual Studio/2022",
    "C:/Program Files (x86)/Microsoft Visual Studio/2022",
    "C:/Program Files/Microsoft Visual Studio/2019",
    "C:/Program Files (x86)/Microsoft Visual Studio/2019",
  ];

  const editions = ["Enterprise", "Professional", "Community", "BuildTools"];

  for (const basePath of vsBasePaths) {
    for (const edition of editions) {
      const vcToolsPath = join(basePath, edition, "VC/Tools/MSVC");
      if (!existsSync(vcToolsPath)) continue;

      // Find MSVC versions and look for editbin
      try {
        const msvcVersions = readdirSync(vcToolsPath);
        for (const version of msvcVersions.reverse()) {
          // reverse to get latest first
          const editbinPath = join(vcToolsPath, version, "bin/Hostx64/x64/editbin.exe");
          if (existsSync(editbinPath)) {
            return editbinPath;
          }
        }
      } catch {}
    }
  }

  return null;
}

/**
 * Patches a Windows executable to use the WINDOWS subsystem (hides console).
 */
async function patchWindowsSubsystem(exePath: string): Promise<boolean> {
  const editbin = findEditBin();
  if (!editbin) {
    console.warn("   ⚠️  editbin not found - console window will be visible");
    console.warn("      Install Visual Studio Build Tools to enable this feature");
    return false;
  }

  try {
    const result = await $`${editbin} /SUBSYSTEM:WINDOWS ${exePath}`.quiet();
    if (result.exitCode === 0) {
      console.log("   ✓ Patched to hide console window");
      return true;
    }

    console.warn("   ⚠️  Failed to patch subsystem:", result.stderr.toString());
    return false;
  } catch (error) {
    console.warn("   ⚠️  Failed to run editbin:", error);
    return false;
  }
}

const PLATFORMS: Record<string, PlatformConfig> = {
  windows: {
    target: "bun-windows-x64",
    outputName: `open-wemo-${VERSION}-win.exe`,
    archiveName: `open-wemo-${VERSION}-windows-x64.zip`,
    // Note: --windows-hide-console conflicts with --windows-icon (Bun bug)
    // We use editbin to patch the subsystem instead
    extraFlags: [`--windows-icon=${WINDOWS_ICON}`],
  },
  mac: {
    target: "bun-darwin-arm64",
    outputName: `open-wemo-${VERSION}-mac`,
    archiveName: `open-wemo-${VERSION}-macos-arm64.zip`,
  },
  "mac-intel": {
    target: "bun-darwin-x64",
    outputName: `open-wemo-${VERSION}-mac-intel`,
    archiveName: `open-wemo-${VERSION}-macos-x64.zip`,
  },
  linux: {
    target: "bun-linux-x64",
    outputName: `open-wemo-${VERSION}-linux`,
    archiveName: `open-wemo-${VERSION}-linux-x64.zip`,
  },
};

/**
 * Generates SHA256 checksum for a file.
 */
function generateChecksum(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Creates a checksum file.
 */
function writeChecksumFile(checksums: Map<string, string>): void {
  const lines = Array.from(checksums.entries())
    .map(([file, hash]) => `${hash}  ${file}`)
    .join("\n");

  const checksumPath = join(DIST_DIR, `checksums-${VERSION}.sha256`);
  writeFileSync(checksumPath, `${lines}\n`);
  console.log(`📝 Checksums written to: checksums-${VERSION}.sha256`);
}

/**
 * Builds for a specific platform.
 */
async function buildPlatform(platform: string): Promise<string | null> {
  const config = PLATFORMS[platform];
  if (!config) {
    console.error(`❌ Unknown platform: ${platform}`);
    return null;
  }

  console.log(`\n🔨 Building for ${platform}...`);
  console.log(`   Target: ${config.target}`);
  console.log(`   Output: ${config.outputName}`);

  const outputPath = join(DIST_DIR, config.outputName);

  try {
    // Build command args - use relative paths from BRIDGE_DIR
    // This is required because --windows-icon doesn't work with absolute paths
    const relativeOutput = `dist/${config.outputName}`;
    const args = [
      "build",
      "src/main.ts",
      "--compile",
      `--target=${config.target}`,
      ...(config.extraFlags ?? []),
      `--outfile=${relativeOutput}`,
    ];

    // Run bun build from BRIDGE_DIR
    const result = Bun.spawnSync(["bun", ...args], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: BRIDGE_DIR,
    });

    if (result.exitCode !== 0) {
      console.error(`❌ Build failed for ${platform}`);
      console.error(result.stderr.toString());
      return null;
    }

    // Verify output exists
    if (!existsSync(outputPath)) {
      console.error(`❌ Output file not created: ${outputPath}`);
      return null;
    }

    // Get file size
    const stats = Bun.file(outputPath);
    const sizeMB = ((await stats.size) / 1024 / 1024).toFixed(2);
    console.log(`   Size: ${sizeMB} MB`);

    // Patch Windows executable to hide console window
    if (platform === "windows") {
      await patchWindowsSubsystem(outputPath);
    }

    return outputPath;
  } catch (error) {
    console.error(`❌ Build error for ${platform}:`, error);
    return null;
  }
}

/**
 * Main build function.
 */
async function build(platforms: string[]): Promise<void> {
  console.log("🏗️  Open Wemo Build Script");
  console.log(`📦 Version: ${VERSION}`);
  console.log(`📁 Output: ${DIST_DIR}`);

  // Ensure dist directory exists
  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }

  const checksums = new Map<string, string>();
  const results: { platform: string; success: boolean; path?: string }[] = [];

  // Build each platform
  for (const platform of platforms) {
    const outputPath = await buildPlatform(platform);

    if (outputPath) {
      results.push({ platform, success: true, path: outputPath });

      // Generate checksum
      const checksum = generateChecksum(outputPath);
      const config = PLATFORMS[platform];
      if (config) checksums.set(config.outputName, checksum);
      console.log(`   SHA256: ${checksum.substring(0, 16)}...`);
    } else {
      results.push({ platform, success: false });
    }
  }

  // Write checksums
  if (checksums.size > 0) {
    writeChecksumFile(checksums);
  }

  // Summary
  console.log("\n📊 Build Summary:");
  console.log("─".repeat(50));

  for (const result of results) {
    const status = result.success ? "✅" : "❌";
    console.log(`${status} ${result.platform}`);
  }

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  console.log("─".repeat(50));
  console.log(`✅ Succeeded: ${successCount}`);
  if (failCount > 0) {
    console.log(`❌ Failed: ${failCount}`);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
let targetPlatforms: string[];

if (args.length === 0 || args[0] === "all") {
  targetPlatforms = Object.keys(PLATFORMS);
} else {
  targetPlatforms = args.filter((arg) => PLATFORMS[arg]);

  if (targetPlatforms.length === 0) {
    console.error("❌ No valid platforms specified");
    console.error("Available platforms:", Object.keys(PLATFORMS).join(", "));
    process.exit(1);
  }
}

// Run build
build(targetPlatforms).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
