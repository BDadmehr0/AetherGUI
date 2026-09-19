#!/bin/sh
# Privileged launcher for the Aethon Linux desktop app's route/DNS helper.
#
# pkexec runs this small, stable path as root; it forwards every argument to the
# installed application binary. The real work happens in the application's own
# CLI entry points (`--routing-helper`, `--repair-network`), which re-derive and
# re-anchor every path they receive from the request files. The polkit action's
# identity stanza (lib/polkit-1/actions/com.aethon.aether-gui.policy) authorizes
# only this helper, so no other program can use the privilege.
#
# Do not add behaviour here. Adding an argument parser to a setuid-adjacent
# wrapper would widen what an unprivileged caller could ask root to run.
AETHON_BIN="${AETHON_BIN:-/usr/lib/aethon/aether-gui}"
exec "$AETHON_BIN" "$@"
