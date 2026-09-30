"""Create the PC-only queue token and print its hash for the database.

Run once on the office PC. The raw token is written only to the ignored
worker/.env file; paste/run the printed SQL with privileged Supabase access.
"""
import hashlib
import secrets
from pathlib import Path

env = Path(__file__).resolve().parents[1] / "worker" / ".env"
if env.exists():
    raise SystemExit("worker/.env already exists; refusing to replace its token")
token = secrets.token_hex(32)
env.write_text(
    "WORKER_TOKEN=" + token + "\nALLOW_SUBMIT=0\nCONFIRMED_SUCCESS_TEXT=\nPOLL_SECONDS=5\n",
    encoding="utf-8",
)
digest = hashlib.sha256(token.encode()).hexdigest()
print("insert into public.transfer_workers(id,token_hash) values ('office-pc','" + digest + "');")
