import { readdirSync, existsSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import electrobunConfig, { windowsIconPath } from "../electrobun.config";

const projectRoot = resolve(import.meta.dir, "..");
const buildRoot = join(projectRoot, "build");
const rceditPath = join(projectRoot, "node_modules", "rcedit", "bin", "rcedit-x64.exe");
const configuredWinIcon = electrobunConfig.build.win?.icon ?? windowsIconPath;
const configuredWinIconPath =
  configuredWinIcon == null
    ? undefined
    : isAbsolute(configuredWinIcon)
      ? configuredWinIcon
      : join(projectRoot, configuredWinIcon);
const fallbackWinIconPath =
  configuredWinIconPath != null &&
  configuredWinIconPath.toLowerCase().endsWith(".ico") &&
  existsSync(configuredWinIconPath)
    ? configuredWinIconPath
    : undefined;

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

function stampBinary(targetPath: string, iconPath: string): boolean {
  const result = spawnSync(rceditPath, [targetPath, "--set-icon", iconPath], {
    stdio: "pipe",
  });

  if (result.error) {
    console.warn(`Failed to stamp icon: ${targetPath}`);
    console.warn(String(result.error));
    return false;
  }

  if (result.status === 0) {
    console.log(`Stamped icon: ${targetPath}`);
    return true;
  }

  const stderr = result.stderr?.toString().trim();
  const stdout = result.stdout?.toString().trim();
  console.warn(`Failed to stamp icon: ${targetPath}`);
  if (stderr) console.warn(stderr);
  else if (stdout) console.warn(stdout);
  return false;
}

function resolveIconPath(
  variantRoot: string,
  tempIconFileName: string,
): string | undefined {
  const generatedIconPath = join(variantRoot, tempIconFileName);
  if (existsSync(generatedIconPath)) {
    return generatedIconPath;
  }

  return fallbackWinIconPath;
}

if (process.platform !== "win32") {
  console.log("Skipping icon stamping on non-Windows platform.");
  process.exit(0);
}

if (!existsSync(buildRoot)) {
  console.log("No build output found; skipping icon stamping.");
  process.exit(0);
}

if (!existsSync(rceditPath)) {
  console.warn(`rcedit not found at ${rceditPath}; skipping icon stamping.`);
  process.exit(0);
}

let attempted = 0;
let failed = 0;

for (const entry of readdirSync(buildRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const variantRoot = join(buildRoot, entry.name);
  const launcherIcon = resolveIconPath(variantRoot, "temp-launcher-icon.ico");
  const bunIcon = resolveIconPath(variantRoot, "temp-bun-icon.ico");
  const setupIcon = resolveIconPath(variantRoot, "temp-icon.ico");

  const files = walk(variantRoot);

  for (const file of files) {
    const name = basename(file).toLowerCase();

    if ((name === "launcher.exe" || name === "launcher") && launcherIcon) {
      attempted += 1;
      if (!stampBinary(file, launcherIcon)) failed += 1;
      continue;
    }

    if (name === "bun.exe" && bunIcon) {
      attempted += 1;
      if (!stampBinary(file, bunIcon)) failed += 1;
      continue;
    }

    if (name.endsWith("-setup.exe") && setupIcon) {
      attempted += 1;
      if (!stampBinary(file, setupIcon)) failed += 1;
    }
  }
}

if (attempted === 0) {
  console.log("No Windows binaries with generated icon payloads were found.");
  process.exit(0);
}

if (failed > 0) {
  console.warn(`Icon stamping completed with ${failed} failure(s).`);
  process.exit(0);
}

console.log(`Icon stamping completed for ${attempted} file(s).`);
