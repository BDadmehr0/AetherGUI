//! Linux-specific support: asking for the privilege the routing helper needs.
//!
//! The privileged work itself (TUN setup, takeover routes, DNS redirection)
//! lives in [`crate::routing`] and runs inside a second copy of this same
//! binary invoked as `--routing-helper <request>` / `--repair-network
//! <session>` — see [`crate::routing::helper_main`] / [`crate::routing::repair_main`].
//! This module owns the single piece Linux adds around that: asking the user for
//! administrator permission through the desktop's native prompt.
//!
//! The wrapper authourised by the shipped polkit action
//! (`linux/polkit/actions/com.aethon.aether-gui.policy`) forwards those two verbs
//! into the installed application binary, which re-derives and re-anchors every
//! path it reads. `pkexec` gives the desktop's prompt; `sudo` and
//! `su --preserve-environment -c` are fallbacks for systemd-less or non-polkit
//! distributions, and every one of them is *only* invoked with the two fixed
//! verb forms — never with a caller-supplied command line.

use std::path::{Path, PathBuf};

/// The executable the polkit action ships for the helper verbs.
const WRAPPER_NAME: &str = "wrap-aether-gui";

/// Candidate locations of the wrapper, derived from the running executable so
/// the search never leaves the application's own install tree.
fn wrapper_candidates(current_exe: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let Some(bin_dir) = current_exe.parent() else {
        return paths;
    };
    // Flat (AppImage/portable/tar) layout: wrapper sits beside the binary.
    paths.push(bin_dir.join(WRAPPER_NAME));
    // Debian/Fedora/Arch packaged layout: /usr/bin/<app>, /usr/lib/aethon/<wrapper>.
    if let Some(prefix) = bin_dir.parent() {
        for share in ["lib", "lib64"] {
            paths.push(prefix.join(share).join("aethon").join(WRAPPER_NAME));
        }
    }
    paths
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Try one escalation mechanism with the two fixed verbs.
fn try_escalate(tool: &str, wrapper: &Path, args: &[&str]) -> Result<(), String> {
    let status = match tool {
        "sudo" => std::process::Command::new("sudo")
            .arg("--preserve-env=AETHON_BIN")
            .arg(wrapper)
            .args(args)
            .status(),
        "su" => {
            let quoted: Vec<String> = args.iter().map(|a| shell_quote(a)).collect();
            std::process::Command::new("su")
                .arg("--preserve-environment")
                .arg("-c")
                .arg(format!(
                    "{} {}",
                    shell_quote(&wrapper.to_string_lossy()),
                    quoted.join(" ")
                ))
                .status()
        }
        _ => std::process::Command::new("pkexec")
            .arg(wrapper)
            .args(args)
            .status(),
    };
    match status {
        Ok(status) if status.success() => Ok(()),
        // `pkexec`/`sudo` returning nonzero is normally "user canceled" or
        // "auth failed" — indistinguishable from here, so it is surfaced as a
        // refusal rather than retried into another prompt.
        Ok(status) => Err(format!(
            "{tool} exited with {}",
            status.code().unwrap_or(1)
        )),
        Err(error) => Err(format!("{tool}: {error}")),
    }
}

const ESCALATION_ORDER: &[&str] = &["pkexec", "sudo", "su"];

/// Ask the desktop for administrator permission and launch the helper verb.
pub fn launch_elevated(mode: &str, path: &Path) -> Result<(), String> {
    let current_exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let wrapper = wrapper_candidates(&current_exe)
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            format!(
                "The Aethon Linux privilege wrapper ({WRAPPER_NAME}) was not found. \
                 Install it next to the application (see linux/polkit)."
            )
        })?;

    let args = [mode, &path.to_string_lossy().into_owned()];
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut attempts = Vec::new();
    for tool in ESCALATION_ORDER {
        match try_escalate(tool, &wrapper, &arg_refs) {
            Ok(()) => return Ok(()),
            Err(error) => attempts.push(format!("{tool}: {error}")),
        }
    }
    Err(format!(
        "Administrator permission was denied or elevation failed ({})",
        attempts.join("; ")
    ))
}

/// True when at least one escalation path and the wrapper both exist, so the
/// caller can turn a hopeless privilege request into a clear error instead of a
/// hanging password prompt inside a terminal-less session.
pub fn can_elevate() -> bool {
    let Ok(current_exe) = std::env::current_exe() else {
        return false;
    };
    if !wrapper_candidates(&current_exe)
        .into_iter()
        .any(|candidate| candidate.is_file())
    {
        return false;
    }
    ESCALATION_ORDER
        .iter()
        .any(|bin| std::env::var_os("PATH").is_none_or(|paths| {
            std::env::split_paths(&paths)
                .map(|dir| dir.join(bin))
                .any(|path| path.is_file())
        }))
}
