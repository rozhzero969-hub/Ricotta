"""Build a one-time SQL call from the private, ignored PDF extraction file.

Usage: python make_seed_sql.py tmp/catalog-import.json tmp/seed.sql
Never commit the resulting SQL: it contains restaurant inventory data.
"""
import json
import sys
from pathlib import Path

source = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if len(source["items"]) != 342:
    raise ValueError("Expected exactly 342 PDF rows")
payload = json.dumps(source, ensure_ascii=False, separators=(",", ":"))
Path(sys.argv[2]).write_text(
    "select public.transfer_seed('" + payload.replace("'", "''") + "'::jsonb) as imported;",
    encoding="utf-8",
)
print(f"Prepared private import for {len(source['items'])} rows")
