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

## Release CI (`linux/release.yml`)

The full Linux-enabled release workflow is kept in this folder as
**`linux/release.yml`**: the upstream `.github/workflows/release.yml` with a
`Linux build and bundle` job (`ubuntu-latest`, WebKitGTK + rust-toolchain,
`fetch:linux`, `cargo test --locked`, then `deb`/`rpm`/`AppImage` via
`tauri.linux.conf.json`) wired into the `publish` job's `needs`, its
`AetherGui-Linux` artifact downloaded beside the Windows/Android one, and the
release-notes body updated to mention Linux.

It is kept here rather than edited in place because the fork-push credential
outside the project cannot modify `.github/workflows/*` (GitHub App
`workflows` permission). To enable Linux releases, copy it over the shipped
workflow — e.g. on the project side run:

    cp linux/release.yml .github/workflows/release.yml

and review the resulting diff before tagging.

