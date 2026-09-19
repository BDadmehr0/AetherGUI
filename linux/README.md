# Aethon Linux desktop

This directory holds the Linux-specific pieces of the Aethon desktop client:
the `iproute2` elevation helper and the polkit authorization for it.

## How system-wide VPN Mode works on Linux

The client (Tauri/WebKitGTK GUI) starts the bundled **Aether** core, which opens
the SOCKS5 listener (`127.0.0.1:1819`) exactly as it does on Windows. In
**VPN Mode**, the GUI then asks the privileged helper to:

1. start the bundled **Xray** routing engine with a TUN inbound that forwards
   into the Aether SOCKS5 upstream,
2. assign the TUN interface addresses and MTU (`ip addr` / `ip link`),
3. install the two `/1` takeover routes that make the default route follow the
   tunnel (`ip route add`), and, when configured,
4. install the take-over-the-DNS rule (`nftables`/`iptables` `OUTPUT`/`PREROUTING`
   to the tunnel's DNS), plus the option to hold traffic in fail-closed mode.

On disconnect (or repair) the same helper tears all of that back down. The
helper is only reachable through the polkit action in
`lib/polkit-1/actions/com.aethon.aether-gui.policy`, which authorises exactly the
two verb forms `wrap-aether-gui --routing-helper <request>` and
`wrap-aether-gui --repair-network <session>`. Everything behind those verbs
re-derives and re-anchors the paths it reads: a request file can be edited by
the unprivileged user, so no path in it is trusted without being checked against
`sessionDir`'s canonical location under the app's own data directory.

Run through a plain `sudo` (no polkit) the same checks still apply; the trust
comes from the anchoring, not from which askpass prompt was used.

## Building

Set the `AETHON_ROUTING_TOOLS` environment variable to the tools your OS uses:

  - `nftables` (recommended, default) — uses `nft` and `iproute2`
  - `iptables` — legacy, uses `iptables` and `iproute2`
  - `none` — no DNS-redirect rule is installed (VPN Mode still routes IP traffic,
    but DNS queries are not forcibly redirected into the tunnel)

Then build as described in the top-level README (`BUILD_TARGET` chooses the
Rust target triple for multi-arch cross builds).

## Package layout (deb shown; tar-based layouts follow the same rules)

```
/usr/bin/aether-gui                     compiled GUI
/usr/lib/aethon/aether-gui              compiled GUI (the helper's identity anchor)
/usr/lib/aethon/aether                 Aether core (musl static)
/usr/lib/aethon/xray                   Xray routing engine
/usr/lib/aethon/wrap-aether-gui        privileged CLI entry point
/usr/lib/aethon/help.sh                legacy alias (kept for older packages)
/usr/share/polkit-1/actions/com.aethon.aether-gui.policy
/usr/share/polkit-1/rules.d/com.aethon.aether-gui.rules
```

## Release CI (add to `.github/workflows/release.yml`)

The repository workflow file cannot be modified by fork-push from outside the
project, so the Linux build job ships as the reviewed snippet below instead.
Add it to `.github/workflows/release.yml` (a `linux` job at the same level as
`build`, and `needs: [build, linux]` on `publish`) before tagging a Linux
release:

```yaml
  linux:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: "22"
          cache: npm
      - uses: dtolnay/rust-toolchain@4360b52568e2003a75bf9bc1d59f33a8e3fc893c
        with:
          toolchain: stable
      - name: Install WebKitGTK and Tauri system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev
      - name: Install dependencies
        run: npm ci
      - name: Fetch and verify Linux sidecars (x86_64)
        env:
          BUILD_TARGET: x86_64-unknown-linux-gnu
        run: npm run fetch:linux
      - name: Test frontend
        run: npm test
      - name: Test Rust backend
        run: cargo test --manifest-path src-tauri/Cargo.toml --locked
      - name: Build Linux bundles (deb, rpm, AppImage)
        env:
          BUILD_TARGET: x86_64-unknown-linux-gnu
        run: npm run build -- --config src-tauri/tauri.linux.conf.json
      - name: Stage Linux release files
        shell: bash
        run: |
          mkdir -p linux-release
          find src-tauri/target/release/bundle -maxdepth 3 -type f \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' \) -exec cp {} linux-release/ \;
          ls -la linux-release
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: AetherGui-Linux
          path: linux-release/*
          if-no-files-found: warn
```
