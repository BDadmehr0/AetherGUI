// Shared helper: read and write the pin data used by the fetch scripts.
//
// `aether-pins.json` and `xray-linux-pins.json` are data rather than .ps1/.mjs
// so they need no execution policy to read and can be consumed by the release
// manifest and SBOM tooling as well as by the fetch scripts.
import { readFileSync, writeFileSync } from "node:fs";

export function loadPins(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function savePins(path, pins) {
  writeFileSync(path, JSON.stringify(pins, null, 2) + "\n");
}
