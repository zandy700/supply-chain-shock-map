"""Save local Alpaca data credentials without printing them or changing broker settings."""
import argparse
import getpass
import json
import os
import re
import sys
import tempfile
from pathlib import Path

NAMES = ("ALPACA_API_KEY", "ALPACA_API_SECRET")


def save_credentials(root, key, secret):
    values = dict(zip(NAMES, (key.strip(), secret.strip())))
    if not all(values.values()) or any("\n" in v or "\r" in v for v in values.values()):
        raise ValueError(
            "Both credentials must be nonempty single-line values. "
            "Existing settings were preserved."
        )
    target = root / ".dev.vars"
    if target.is_symlink():
        raise ValueError(
            "The credentials file is a symbolic link. "
            "Use a regular .dev.vars file before running setup."
        )
    lines = target.read_text().splitlines() if target.exists() else []
    pattern = re.compile(r"^\s*(?:export\s+)?(?:ALPACA_API_KEY|ALPACA_API_SECRET)\s*=")
    other = [line for line in lines if not pattern.match(line)]
    with tempfile.NamedTemporaryFile("w", dir=root, prefix=".dev.vars.", delete=False) as output:
        try:
            entries = other + [k + "=" + json.dumps(v) for k, v in values.items()]
            output.write("\n".join(entries) + "\n")
            output.close()
            os.chmod(output.name, 0o600)
            os.replace(output.name, target)
        finally:
            Path(output.name).unlink(missing_ok=True)


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    if not sys.stdin.isatty():
        raise SystemExit(
            "Run npm run alpaca:setup in your own Terminal "
            "so both credentials can be entered privately."
        )
    key = getpass.getpass("Alpaca API key ID (hidden): ")
    secret = getpass.getpass("Alpaca API secret (hidden): ")
    try:
        save_credentials(Path(__file__).resolve().parents[1], key, secret)
    except ValueError as error:
        raise SystemExit(str(error)) from None
    print(
        "Saved local Alpaca credentials. "
        "Restart the Worker, then check /api/space/options/status."
    )
    print("The integration explicitly uses the free indicative feed; it does not place trades.")


if __name__ == "__main__":
    main()
