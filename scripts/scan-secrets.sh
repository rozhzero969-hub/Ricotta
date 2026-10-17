#!/bin/sh
# Official Gitleaks release, pinned checksum; never print discovered secret values.
set -eu
scan_dir=$(mktemp -d)
trap 'rm -rf "$scan_dir"' EXIT
curl --fail --silent --show-error --location https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz -o "$scan_dir/gitleaks.tar.gz"
printf '%s  %s\n' '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb' "$scan_dir/gitleaks.tar.gz" | sha256sum --check --status
tar -xzf "$scan_dir/gitleaks.tar.gz" -C "$scan_dir" gitleaks
"$scan_dir/gitleaks" git --log-opts='--all' --redact=100 --no-banner .
"$scan_dir/gitleaks" dir --redact=100 --no-banner --max-target-megabytes=8 .
