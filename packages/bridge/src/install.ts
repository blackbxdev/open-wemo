/**
 * Auto-Install Module
 *
 * Handles automatic installation of the executable to a persistent location.
 * On first run from a temporary location (like Downloads), the app will:
 * 1. Copy itself to %LOCALAPPDATA%\Open Wemo\ (Windows) or ~/Applications (macOS) or ~/.local/bin (Linux)
 * 2. Launch the installed copy
 * 3. Exit the original process
 *
 * This ensures the "Start on login" feature works correctly since the exe
 * path in the registry/launch agent will be stable.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/** Application name for install directory */
const APP_NAME = "Open Wemo";

/** Executable name */
const EXE_NAME = platform() === "win32" ? "open-wemo.exe" : "open-wemo";

/**
 * Gets the installation directory for the current platform.
 */
export function getInstallDir(): string {
  switch (platform()) {
    case "win32":
      // %LOCALAPPDATA%\Open Wemo
      return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), APP_NAME);
    case "darwin":
      // ~/Applications
      return join(homedir(), "Applications");
    case "linux":
      // ~/.local/bin
      return join(homedir(), ".local", "bin");
    default:
      return join(homedir(), ".open-wemo");
  }
}

/**
 * Gets the full path to the installed executable.
 */
export function getInstalledExePath(): string {
  return join(getInstallDir(), EXE_NAME);
}

/**
 * Gets the current executable path.
 */
function getCurrentExePath(): string {
  return process.execPath;
}

/**
 * Checks if we're running as a compiled binary (not dev mode).
 */
function isCompiledBinary(): boolean {
  return import.meta.dir.includes("~BUN") || import.meta.dir.startsWith("$bunfs");
}

/**
 * Normalizes a path for comparison (lowercase, forward slashes).
 */
function normalizePath(p: string): string {
  return p.toLowerCase().replace(/\\/g, "/");
}

/**
 * Checks if we're running from the installed location.
 */
export function isInstalledLocation(): boolean {
  if (!isCompiledBinary()) {
    // Dev mode - consider as "installed" (don't try to self-install)
    return true;
  }

  const currentPath = normalizePath(getCurrentExePath());
  const installDir = normalizePath(getInstallDir());
  const installedExePath = normalizePath(getInstalledExePath());

  console.log(`[Install] Current exe path: ${currentPath}`);
  console.log(`[Install] Install directory: ${installDir}`);
  console.log(`[Install] Expected installed path: ${installedExePath}`);

  // Check if current path matches the installed exe path exactly, or is within install directory
  const isInstalled = currentPath === installedExePath || currentPath.startsWith(`${installDir}/`);

  console.log(`[Install] Is installed location: ${isInstalled}`);

  return isInstalled;
}

/**
 * Checks if the app is already installed.
 */
export function isAlreadyInstalled(): boolean {
  const installedPath = getInstalledExePath();
  return existsSync(installedPath);
}

/**
 * Installs the executable to the persistent location.
 * Returns the path to the installed executable, or null if installation failed.
 */
export function installExecutable(): string | null {
  if (!isCompiledBinary()) {
    console.log("[Install] Skipping installation in dev mode");
    return null;
  }

  const currentPath = getCurrentExePath();
  const installDir = getInstallDir();
  const installedPath = getInstalledExePath();

  console.log(`[Install] Current location: ${currentPath}`);
  console.log(`[Install] Install location: ${installedPath}`);

  try {
    // Create install directory if it doesn't exist
    if (!existsSync(installDir)) {
      console.log(`[Install] Creating directory: ${installDir}`);
      mkdirSync(installDir, { recursive: true });
    }

    // Check if we need to update (current exe is newer)
    let shouldCopy = true;
    if (existsSync(installedPath)) {
      const currentStat = statSync(currentPath);
      const installedStat = statSync(installedPath);

      // Only copy if current file is different size (simple check)
      // or if current is newer
      if (currentStat.size === installedStat.size && currentStat.mtime <= installedStat.mtime) {
        console.log("[Install] Installed version is up to date");
        shouldCopy = false;
      } else {
        console.log("[Install] Updating installed version");
      }
    }

    if (shouldCopy) {
      // Copy the executable
      console.log("[Install] Copying executable...");
      copyFileSync(currentPath, installedPath);
      console.log("[Install] Installation complete");
    }

    return installedPath;
  } catch (error) {
    console.error("[Install] Installation failed:", error);
    return null;
  }
}

/**
 * Launches the installed executable and returns true if successful.
 * The current process should exit after calling this.
 */
export function launchInstalled(): boolean {
  const installedPath = getInstalledExePath();

  if (!existsSync(installedPath)) {
    console.error("[Install] Cannot launch - not installed");
    return false;
  }

  console.log(`[Install] Launching installed version: ${installedPath}`);

  try {
    if (platform() === "win32") {
      // On Windows, use PowerShell Start-Process for proper detached launch
      // -WindowStyle Hidden ensures no console window, even though we patched the exe
      const psCommand = `Start-Process -FilePath '${installedPath.replace(/'/g, "''")}'`;
      console.log(`[Install] PowerShell command: ${psCommand}`);
      Bun.spawnSync(["powershell", "-Command", psCommand]);
    } else {
      // On Unix, spawn detached
      const subprocess = Bun.spawn([installedPath], {
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
      subprocess.unref();
    }

    return true;
  } catch (error) {
    console.error("[Install] Failed to launch installed version:", error);
    return false;
  }
}

/**
 * Main install flow - call this at app startup.
 * Returns true if the app should continue running, false if it should exit
 * (because the installed version was launched instead).
 */
export function handleAutoInstall(): boolean {
  // Skip in dev mode
  if (!isCompiledBinary()) {
    return true;
  }

  // Already running from installed location
  if (isInstalledLocation()) {
    console.log("[Install] Running from installed location");
    return true;
  }

  console.log("[Install] Running from temporary location, initiating install...");

  // Install the executable
  const installedPath = installExecutable();
  if (!installedPath) {
    console.warn("[Install] Installation failed, continuing from current location");
    return true;
  }

  // Launch the installed version
  if (launchInstalled()) {
    console.log("[Install] Installed version launched, exiting...");
    return false; // Signal to exit
  }

  // Launch failed, continue with current instance
  console.warn("[Install] Failed to launch installed version, continuing from current location");
  return true;
}
