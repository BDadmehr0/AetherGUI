// Fetch and verify the Linux Xray routing engine for the requested Rust target.
//
// Mirrors scripts/fetch-xray.ps1 for the Windows engine. The expected archive
// digest is pinned in scripts/xray-linux-pins.json (API-sourced); the extracted
// binary's SHA-256 is derived at fetch time and recorded in the pins file,
// mirroring repository practice for every other shipped engine.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = resolve(__dirname, "..");
const pinsPath = join(__dirname, "xray-linux-pins.json");
const pins = JSON.parse(readFileSync(pinsPath, "utf8"));
const baseUrl = `https://github.com/XTLS/Xray-core/releases/download/${pins.version}`;

// zip → (uname arch, extracted binary name).
const BY_ARCHIVE = {
  "Xray-linux-64.zip": { arch: "x86_64", binary: "xray" },
  "Xray-linux-arm64-v8a.zip": { arch: "arm64", binary: "xray" },
  "Xray-linux-arm32-v7a.zip": { arch: "armv7", binary: "xray" },
};
const BY_ARCH = Object.fromEntries(
  Object.entries(BY_ARCHIVE).map(([archive, meta]) => [meta.arch, { ...meta, archive }])
);

// Rust target triple → which engine archive to fetch. The staged file is always
// named `xray-<triple>`: Tauri's `externalBin: ["binaries/xray"]` resolves to
// `src-tauri/binaries/xray-<target-triple>` at build time, so staging a plain
// `xray` fails the build with
// "resource path `binaries/xray-<triple>` doesn't exist".
const TARGETS = {
  "x86_64-unknown-linux-gnu": { arch: "x86_64" },
  "x86_64-unknown-linux-musl": { arch: "x86_64" },
  "aarch64-unknown-linux-gnu": { arch: "arm64" },
  "aarch64-unknown-linux-musl": { arch: "arm64" },
  "armv7-unknown-linux-gnueabihf": { arch: "armv7" },
  "armv7-unknown-linux-musleabihf": { arch: "armv7" },
};

// Default to the host CPU when BUILD_TARGET is unset, so a bare
// `npm run fetch:routing:linux` on an ARM machine does not fetch (and mislabel)
// an x86_64 binary it can neither execute nor bundle.
const DEFAULT_TARGET_BY_ARCH = {
  x64: "x86_64-unknown-linux-gnu",
  arm64: "aarch64-unknown-linux-gnu",
  arm: "armv7-unknown-linux-gnueabihf",
};
const buildTarget =
  process.env.BUILD_TARGET ||
  DEFAULT_TARGET_BY_ARCH[process.arch] ||
  "x86_64-unknown-linux-gnu";
const spec = TARGETS[buildTarget];
if (!spec) {
  throw new Error(
    `${buildTarget} is not a supported Linux target (expected one of ${Object.keys(TARGETS).join(", ")})`
  );
}
const fileName = `xray-${buildTarget}`;

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
  const existing = pins.binary[archive];
  if (existing && existing !== digest) {
    throw new Error(
      `The extracted xray binary does not match the pin in scripts/xray-linux-pins.json. ` +
      `Expected ${existing}, got ${digest}. Update linux_engine_pins in src-tauri/src/routing.rs ` +
      `in the same reviewed commit.`
    );
  }
  if (!existing) {
    pins.binary[archive] = digest;
    writeFileSync(pinsPath, JSON.stringify(pins, null, 2) + "\n");
    console.log(
      `[fetch] recorded first-seen binary digest for ${archive}: ${digest}. ` +
      `Review this change to scripts/xray-linux-pins.json in the same commit that sets ` +
      `routing.rs XRAY_SHA256.`
    );
  }
}

async function main() {
  const meta = BY_ARCH[spec.arch];
  const expected = pins.archives[meta.archive];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error(`${meta.archive} is not pinned in scripts/xray-linux-pins.json`);
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

  // Xray Linux archives are zip files whose root holds `xray` and a geoip/geosite
  // data directory. Only the executable is shipped; routing rules in Aethon are
  // IP/CIDR based, not rule-set file based.
  run(`mkdir -p "${workDir}/x" && unzip -o "${archivePath}" -d "${workDir}/x" >/dev/null`);
  const expanded = join(workDir, "x");
  const entry = readdirSync(expanded, { withFileTypes: true })
    .find((e) => e.isFile() && e.name === "xray");
  if (!entry) throw new Error("xray executable was not found in the verified upstream archive");
  const binaryPath = join(expanded, entry.name);
  const binaryDigest = sha256File(binaryPath);

  recordBinaryPin(meta.archive, binaryDigest);

  const destDir = resolve(repo, "src-tauri", "binaries");
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, fileName);
  copyFileSync(binaryPath, dest);
  // The bundler preserves the file mode into deb/rpm/AppImage, and the staged
  // copy must be executable for the shipped app (and the `cargo test` engine
  // checks) to run it. Set explicitly: copyFileSync is not guaranteed to carry
  // the executable bit across filesystems.
  chmodSync(dest, 0o755);
  writeFileSync(
    join(destDir, `${fileName}.sha256`),
    `${binaryDigest}  ${fileName}\n`
  );
  console.log(
    `[fetch] prepared verified Xray ${pins.version} (${meta.archive}) ` +
    `for ${buildTarget} as ${fileName}; binary SHA256 ${binaryDigest}`
  );
  rmSync(workDir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(`[fetch] ${error.message}`);
  process.exit(1);
});
