#!/bin/sh
# Official Gitleaks release, pinned checksum; never print discovered secret values.
set -eu
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) target=darwin_arm64; checksum=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5 ;;
  Darwin-x86_64) target=darwin_x64; checksum=dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709 ;;
  Linux-aarch64|Linux-arm64) target=linux_arm64; checksum=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;;
  Linux-x86_64) target=linux_x64; checksum=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  *) echo 'Unsupported system for the pinned secret scanner' >&2; exit 1 ;;
esac
scan_dir=$(mktemp -d)
trap 'rm -rf "$scan_dir"' EXIT
curl --fail --silent --show-error --location "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_${target}.tar.gz" -o "$scan_dir/gitleaks.tar.gz"
if command -v shasum >/dev/null 2>&1; then
  printf '%s  %s\n' "$checksum" "$scan_dir/gitleaks.tar.gz" | shasum -a 256 -c - >/dev/null
else
  printf '%s  %s\n' "$checksum" "$scan_dir/gitleaks.tar.gz" | sha256sum -c - >/dev/null
fi
tar -xzf "$scan_dir/gitleaks.tar.gz" -C "$scan_dir" gitleaks
"$scan_dir/gitleaks" git --log-opts='--all' --redact=100 --no-banner .
"$scan_dir/gitleaks" dir --redact=100 --no-banner --max-target-megabytes=8 .
