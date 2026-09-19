// SHA-256 helpers shared by the sidecar fetchers.
//
// The digests come from this repository (the pins files), not from the server
// being downloaded from. An archive and its `.sha256` companion share one base
// URL and therefore one trust boundary, so fetching the checksum from beside
// the archive would only prove the transfer was intact; the pinned value is the
// authority and it lives here.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hasher = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hasher.update(chunk));
    stream.on("end", () => resolve(hasher.digest("hex")));
  });
}

export function isHexDigest(value) {
  return /^[a-f0-9]{64}$/.test(String(value));
}

export function assertDigest(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} checksum mismatch. Expected ${expected}, got ${actual}.`);
  }
}
