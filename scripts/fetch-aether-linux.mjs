// Fetch and verify the Linux Aether core binary for the requested Rust target.
//
// Mirrors scripts/fetch-aether.ps1 for the Windows core. The expected archive
// digest is pinned in scripts/linux-sidecar-pins.json (sourced from the
// release-asset metadata GitHub reports through its API — a different trust
// boundary from the release's own .sha256 file beside the archive). The
// extracted binary's SHA-256 is derived here; where the pins file already
// records one it must match, and where it is empty this run records it so a
// later build enforces it. This is the same two-tier "archives" / "binary"
// model aether-pins.json uses for Windows and Android.
//
// The core is a SOCKS5 provider compiled for a static musl libc, so one
// x86_64/aarch64/armv7 binary runs on any Linux distribution of that family.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = resolve(__dirname, "..");
const pinsPath = join(__dirname, "linux-sidecar-pins.json");
const pins = JSON.parse(readFileSync(pinsPath, "utf8"));
const baseUrl = `https://github.com/CluvexStudio/Aether/releases/download/${pins.version}`;

// `uname -m` value → archive + extracted binary name. Only the fully-static
// musl builds are used so a single artifact covers every glibc and musl system.
const BY_ARCH = {
  x86_64: { uname: ["x86_64", "amd64"], archive: "aether-linux-x86_64-musl.tar.gz" },
  arm64: { uname: ["aarch64", "arm64"], archive: "aether-linux-aarch64-musl.tar.gz" },
  armv7: { uname: ["armv7l", "armv8l", "arm"], archive: "aether-linux-armv7-musl.tar.gz" },
};

// Rust target triple → which core archive to fetch and what to name the binary
// on disk. Windows/Android (and any other platform) are refused up front so a
// mis-targeted build fails at fetch time rather than shipping an empty bundle.
const TARGETS = {
  "x86_64-unknown-linux-gnu": { arch: "x86_64", name: "aether" },
  "x86_64-unknown-linux-musl": { arch: "x86_64", name: "aether" },
  "aarch64-unknown-linux-gnu": { arch: "arm64", name: "aether" },
  "aarch64-unknown-linux-musl": { arch: "arm64", name: "aether" },
  "armv7-unknown-linux-gnueabihf": { arch: "armv7", name: "aether" },
  "armv7-unknown-linux-musleabihf": { arch: "armv7", name: "aether" },
};

const spec = TARGETS[process.env.BUILD_TARGET] ??
  TARGETS["x86_64-unknown-linux-gnu"];

function sha256File(path) {
  const hasher = createHash("sha256");
  hasher.update(readFileSync(path));
  return hasher.digest("hex");
}

function run(command) {
  const result = spawnSync(command, { shell: true, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`command failed with status ${result.status ?? "signal"}`);
  }
}

function recordBinaryPin(archive, digest) {
  const existing = pins.linuxBinary[archive];
  if (existing && existing !== digest) {
    throw new Error(
      `The extracted aether binary does not match the pin recorded in ` +
      `scripts/linux-sidecar-pins.json. Expected ${existing}, got ${digest}. ` +
      `Update AETHER_SHA256 in src-tauri/src/process.rs in the same reviewed commit.`
    );
  }
  if (!existing) {
    pins.linuxBinary[archive] = digest;
    writeFileSync(pinsPath, JSON.stringify(pins, null, 2) + "\n");
    console.log(
      `[fetch] recorded first-seen binary digest for ${archive}: ${digest}. ` +
      `Review this change to scripts/linux-sidecar-pins.json in the same commit ` +
      `that sets process.rs AETHER_SHA256.`
    );
  }
}

async function main() {
  const meta = BY_ARCH[spec.arch];
  const expected = pins.linuxArchives[meta.archive];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error(`${meta.archive} is not pinned in scripts/linux-sidecar-pins.json`);
  }

  const cacheDir = join(__dirname, "cache");
  mkdirSync(cacheDir, { recursive: true });
  const archivePath = join(cacheDir, meta.archive);
  const workDir = join(cacheDir, `work-${process.pid}`);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  // Mirror sources are opt-in only (AETHER_MIRROR_BASE is a space-separated
  // list). No default is hardcoded: an unauthenticated proxy sits between the
  // build machine and the release artifact, so using one must be a deliberate,
  // reviewable choice rather than a silent fallback.
  const mirrorBase = String(process.env.AETHER_MIRROR_BASE || "")
      .split(/\s+/)
      .filter(Boolean);
  const sources = [
    ["direct", `${baseUrl}/${meta.archive}`],
    ...mirrorBase.map((m) => [`mirror ${m}`, `${m}${baseUrl}/${meta.archive}`]),
  ];

  let obtained = false;
  for (const [label, url] of sources) {
    console.log(`[fetch] ${label}: ${url}`);
    const result = spawnSync(
      `curl -fL --retry 3 --retry-all-errors --max-time 300 "${url}" -o "${archivePath}"`,
      { shell: true, stdio: "inherit" }
    );
    if (result.status !== 0 || !existsSync(archivePath)) continue;
    const actual = sha256File(archivePath);
    if (actual !== expected) {
      console.error(`[fetch] ${label} digest mismatch (expected ${expected})`);
      continue;
    }
    obtained = true;
    break;
  }

  if (!obtained && process.env.AETHER_ASSET_CACHE) {
    const cachedPath = join(process.env.AETHER_ASSET_CACHE, meta.archive);
    if (existsSync(cachedPath) && sha256File(cachedPath) === expected) {
      console.log(`[fetch] using verified cache copy ${cachedPath}`);
      copyFileSync(cachedPath, archivePath);
      obtained = true;
    }
  }

  if (!obtained) {
    throw new Error(
      `Could not obtain ${meta.archive} matching the pinned digest ${expected}.` +
      ` Populate AETHER_ASSET_CACHE or AETHER_MIRROR_BASE and retry.`
    );
  }

  // Aether archives are tar.gz holding a single `aether` executable at the root.
  run(`mkdir -p "${workDir}/x" && tar -xzf "${archivePath}" -C "${workDir}/x"`);
  const expanded = join(workDir, "x");
  const entry = readdirSync(expanded, { withFileTypes: true })
    .find((e) => e.isFile() && e.name === "aether");
  if (!entry) {
    throw new Error("aether executable was not found in the verified upstream archive");
  }
  const binaryPath = join(expanded, entry.name);
  const binaryDigest = sha256File(binaryPath);

  // Verify against this repository's record (and record the first derivation).
  recordBinaryPin(meta.archive, binaryDigest);

  const destDir = resolve(repo, "src-tauri", "binaries");
  mkdirSync(destDir, { recursive: true });
  copyFileSync(binaryPath, join(destDir, spec.name));
  writeFileSync(
    join(destDir, `${spec.name}.sha256`),
    `${binaryDigest}  ${spec.name}\n`
  );
  console.log(
    `[fetch] prepared verified Aether ${pins.version} core ` +
    `(${meta.archive}) for ${process.env.BUILD_TARGET || spec.arch} ` +
    `as ${spec.name}; binary SHA256 ${binaryDigest}`
  );
  rmSync(workDir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(`[fetch] ${error.message}`);
  process.exit(1);
});
