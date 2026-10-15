// Reclaim a Chromium user-data-dir left locked by zombie processes (common on Windows
// when MCP restarts without closing Playwright). Only touches Chrome whose command line
// contains this profile path — not the user's Google Chrome.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const log = (...a) => console.error("[profile]", ...a);

const LOCK_NAMES = ["SingletonLock", "SingletonCookie", "SingletonSocket"];

export function clearSingletonLocks(profileDir) {
  let removed = 0;
  for (const name of LOCK_NAMES) {
    const p = join(profileDir, name);
    if (!existsSync(p)) continue;
    try {
      unlinkSync(p);
      removed++;
    } catch (err) {
      log("unlock", name, err?.message || err);
    }
  }
  return removed;
}

/** PIDs of chrome.exe / Chromium whose CommandLine includes profileDir. */
export async function listProfilePids(profileDir) {
  const needle = profileDir.replace(/\//g, "\\");
  if (process.platform === "win32") {
    const escaped = needle.replace(/'/g, "''");
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | ` +
          `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${escaped}') } | ` +
          `ForEach-Object { $_.ProcessId }`,
      ],
      { windowsHide: true, timeout: 20000, encoding: "utf8" }
    );
    return [...new Set(String(stdout).split(/\s+/).map(Number).filter((n) => n > 0))];
  }
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", profileDir], {
      timeout: 10000,
      encoding: "utf8",
    });
    return [...new Set(String(stdout).split(/\s+/).map(Number).filter((n) => n > 0))];
  } catch (err) {
    if (err?.code === 1) return []; // pgrep: no matches
    throw err;
  }
}

export async function killPids(pids) {
  for (const pid of pids) {
    try {
      if (process.platform === "win32") {
        await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          timeout: 10000,
        });
      } else {
        process.kill(pid, "SIGKILL");
      }
      log("killed", pid);
    } catch (err) {
      log("kill", pid, err?.message || err);
    }
  }
}

/**
 * Free the profile for a new launchPersistentContext.
 * Safe when no other market-mcp owns the profile; kills leftovers from crashed MCP.
 */
export async function reclaimProfile(profileDir) {
  let pids = [];
  try {
    pids = await listProfilePids(profileDir);
  } catch (err) {
    log("list pids:", err?.message || err);
  }
  if (pids.length) {
    log(`reclaiming ${pids.length} process(es) for ${profileDir}`);
    await killPids(pids);
    await new Promise((r) => setTimeout(r, 400));
  }
  const locks = clearSingletonLocks(profileDir);
  if (locks) log("removed", locks, "singleton lock file(s)");
  return { pids: pids.length, locks };
}
