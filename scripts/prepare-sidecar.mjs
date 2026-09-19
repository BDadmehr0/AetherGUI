// Stage the Aether core for the platform the build targets.
//
// Windows builds read the verified `aether-x86_64-pc-windows-msvc.exe`
// (produced by scripts/fetch-aether.ps1). Linux builds read the verified
// `aether` produced by scripts/fetch-aether-linux.mjs for BUILD_TARGET. The
// names match what src-tauri/src/process.rs resolves and hash-checks before
// anything is spawned.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const linux = process.platform === "linux" || /linux/.test(process.env.BUILD_TARGET || "");
const target = linux ? "unknown-linux" : "x86_64-pc-windows-msvc";
const fileName = linux ? "aether" : `aether-${target}.exe`;

const destination = resolve("src-tauri/binaries", fileName);
if (existsSync(destination) && !process.env.AETHER_CORE_BINARY) {
  console.log(`Using bundled Aether core at ${destination}`);
  process.exit(0);
}

const fallback = linux ? resolve("vendor/aether") : resolve("vendor/aether.exe");
const candidates = [process.env.AETHER_CORE_BINARY, fallback].filter(Boolean);
const source = candidates.find(existsSync);
if (!source) {
  throw new Error(
    linux
      ? "Aether core is missing. Run `npm run fetch:core:linux` or set AETHER_CORE_BINARY."
      : "Aether core is missing. Run `npm run fetch:core` or set AETHER_CORE_BINARY."
  );
}

mkdirSync(resolve("src-tauri/binaries"), { recursive: true });
copyFileSync(source, destination);
console.log(`Bundling Aether core from ${source}`);
