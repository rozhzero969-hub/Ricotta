#!/usr/bin/env bash
# Run only against an EMPTY disposable Postgres database, via normal PG* variables.
set -euo pipefail
cd "$(dirname "$0")/.."
psql -X -v ON_ERROR_STOP=1 -q -f scripts/db-fixture.sql
for migration in supabase/migrations/20260930*_stock*.sql supabase/migrations/20261001*.sql supabase/migrations/20261002*.sql supabase/migrations/20261003*.sql; do
  psql -X -v ON_ERROR_STOP=1 -q -f "$migration"
done
psql -X -v ON_ERROR_STOP=1 -q -f scripts/stock-db-smoke.sql
psql -X -v ON_ERROR_STOP=1 -q -f scripts/atomic-db-smoke.sql
psql -X -v ON_ERROR_STOP=1 -q -f scripts/submission-recovery-smoke.sql
