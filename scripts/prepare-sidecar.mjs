// Stage the Aether core for the platform the build targets.
//
// Windows builds read the verified `aether-x86_64-pc-windows-msvc.exe`
// (produced by scripts/fetch-aether.ps1). Linux builds read the verified
// `aether-<triple>` produced by scripts/fetch-aether-linux.mjs for
// BUILD_TARGET: Tauri's `externalBin: ["binaries/aether"]` resolves to
// `src-tauri/binaries/aether-<target-triple>` at build time, so the staged
// name must carry the triple or the build fails with
// "resource path `binaries/aether-<triple>` doesn't exist".
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Must agree with the fetch scripts: the triple in the staged file name has to
// be the triple the Rust build targets, and an unset BUILD_TARGET means the
// host CPU, not unconditionally x86_64.
const DEFAULT_LINUX_TARGET_BY_ARCH = {
  x64: "x86_64-unknown-linux-gnu",
  arm64: "aarch64-unknown-linux-gnu",
  arm: "armv7-unknown-linux-gnueabihf",
};
const buildTarget =
  process.env.BUILD_TARGET ||
  DEFAULT_LINUX_TARGET_BY_ARCH[process.arch] ||
  "x86_64-unknown-linux-gnu";
const linux = process.platform === "linux" || /linux/.test(process.env.BUILD_TARGET || "");
const fileName = linux ? `aether-${buildTarget}` : `aether-x86_64-pc-windows-msvc.exe`;

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
if (linux) {
  // The bundler preserves the file mode into the Linux packages; the staged
  // copy must be executable for the shipped app to spawn it.
  chmodSync(destination, 0o755);
}
console.log(`Bundling Aether core from ${source}`);
