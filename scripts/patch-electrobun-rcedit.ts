import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const originalDirSource =
  "D:\\\\a\\\\electrobun\\\\electrobun\\\\package\\\\node_modules\\\\rcedit\\\\lib";
const runtimeDirSourceBase = "node_modules\\\\rcedit\\\\lib";
const noopLongSourceSegment = "\\\\a\\\\..";
const noopShortSourceSegment = "\\\\.";
const binaryTargets = [
  join(projectRoot, "node_modules", "electrobun", "bin", "electrobun.exe"),
  join(projectRoot, "node_modules", "electrobun", ".cache", "electrobun.exe"),
];

function buildPatchedDirSource(): string {
  const paddingLength = originalDirSource.length - runtimeDirSourceBase.length;

  for (
    let longSegmentCount = Math.floor(paddingLength / noopLongSourceSegment.length);
    longSegmentCount >= 0;
    longSegmentCount -= 1
  ) {
    const remainingLength = paddingLength - longSegmentCount * noopLongSourceSegment.length;
    if (remainingLength % noopShortSourceSegment.length !== 0) {
      continue;
    }

    const shortSegmentCount = remainingLength / noopShortSourceSegment.length;
    const patchedDirSource =
      runtimeDirSourceBase +
      noopLongSourceSegment.repeat(longSegmentCount) +
      noopShortSourceSegment.repeat(shortSegmentCount);

    if (patchedDirSource.length === originalDirSource.length) {
      return patchedDirSource;
    }
  }

  throw new Error(
    `Unable to build replacement rcedit path with length ${originalDirSource.length}.`,
  );
}

function countMatches(haystack: Buffer, needle: Buffer): number {
  let count = 0;
  let offset = 0;

  while (true) {
    const matchIndex = haystack.indexOf(needle, offset);
    if (matchIndex === -1) {
      return count;
    }
    count += 1;
    offset = matchIndex + needle.length;
  }
}

function patchBinary(binaryPath: string, replacementDirSource: string): void {
  if (!existsSync(binaryPath)) {
    console.log(`Skipping missing Electrobun binary: ${binaryPath}`);
    return;
  }

  const originalSnippet = Buffer.from(
    `var __dirname = "${originalDirSource}";`,
    "utf8",
  );
  const replacementSnippet = Buffer.from(
    `var __dirname = "${replacementDirSource}";`,
    "utf8",
  );

  if (originalSnippet.length !== replacementSnippet.length) {
    throw new Error("Electrobun monkeypatch must preserve the bundled snippet length.");
  }

  const contents = readFileSync(binaryPath);

  if (contents.indexOf(replacementSnippet) !== -1) {
    console.log(`Electrobun rcedit path already patched: ${binaryPath}`);
    return;
  }

  const matchCount = countMatches(contents, originalSnippet);
  if (matchCount !== 1) {
    throw new Error(
      `Expected exactly one bundled rcedit path in ${binaryPath}, found ${matchCount}.`,
    );
  }

  const matchIndex = contents.indexOf(originalSnippet);
  replacementSnippet.copy(contents, matchIndex);
  writeFileSync(binaryPath, contents);
  console.log(`Patched Electrobun rcedit path: ${binaryPath}`);
}

if (process.platform !== "win32") {
  console.log("Skipping Electrobun rcedit monkeypatch on non-Windows platform.");
  process.exit(0);
}

const replacementDirSource = buildPatchedDirSource();
for (const binaryPath of binaryTargets) {
  patchBinary(binaryPath, replacementDirSource);
}
