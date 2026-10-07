#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/monthly-db-smoke.cjs
