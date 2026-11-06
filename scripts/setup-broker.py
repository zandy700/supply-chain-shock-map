"""Set the local Worker OAuth credentials without putting secrets in shell history."""
import getpass
import json
import os
from pathlib import Path
import re
import tempfile

root = Path(__file__).resolve().parents[1]
target = root / ".dev.vars"
values = {
    "SNAPTRADE_OAUTH_CLIENT_ID": input("SnapTrade Test OAuth client ID: ").strip(),
    "SNAPTRADE_OAUTH_CLIENT_SECRET": getpass.getpass("SnapTrade Test OAuth client secret (hidden): ").strip(),
}
if not all(values.values()):
    raise SystemExit("Both credentials are required. Existing settings were preserved.")
lines = target.read_text().splitlines() if target.exists() else []
other = [line for line in lines if not re.match(r"^\s*(?:export\s+)?(?:SNAPTRADE_OAUTH_CLIENT_ID|SNAPTRADE_OAUTH_CLIENT_SECRET)\s*=", line)]
with tempfile.NamedTemporaryFile("w", dir=root, prefix=".dev.vars.", delete=False) as output:
    try:
        output.write("\n".join(other + [k + "=" + json.dumps(v) for k, v in values.items()]) + "\n")
        output.close()
        os.replace(output.name, target)
    finally:
        Path(output.name).unlink(missing_ok=True)
print("Saved local Worker credentials. Run npm run dev and open http://127.0.0.1:8787/#/portfolio")
