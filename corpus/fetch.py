#!/usr/bin/env python3
"""Fetch the third-party test corpus this checker is measured against.

The files are not redistributed here. They belong to the musicxmlTestSuite
repository (MIT, see LICENSE in this folder) and this script pulls the exact
60 named in FILES.txt from the source named in PROVENANCE.md.

    python corpus/fetch.py

Files already present are left alone. Anything that does not return HTTP 200
is reported and the script exits non-zero, because a corpus that is quietly
short is worse than no corpus: acceptance test 6 would pass on 40 files and
still say "no false alarms".
"""
import os
import sys
import urllib.request

BASE = "https://raw.githubusercontent.com/cuthbertLab/musicxmlTestSuite/main/xmlFiles/"
HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    with open(os.path.join(HERE, "FILES.txt"), encoding="utf-8") as fh:
        names = [line.strip() for line in fh if line.strip()]

    failed = []
    for name in names:
        target = os.path.join(HERE, name)
        if os.path.exists(target):
            continue
        try:
            with urllib.request.urlopen(BASE + name, timeout=30) as resp:
                if resp.status != 200:
                    failed.append((name, resp.status))
                    continue
                body = resp.read()
        except Exception as exc:                      # noqa: BLE001 - report, do not mask
            failed.append((name, repr(exc)))
            continue
        with open(target, "wb") as fh:
            fh.write(body)
        print("fetched", name)

    have = sum(1 for n in names if os.path.exists(os.path.join(HERE, n)))
    print("corpus: %d of %d files present" % (have, len(names)))
    for name, why in failed:
        print("FAILED", name, why, file=sys.stderr)
    return 1 if failed or have != len(names) else 0


if __name__ == "__main__":
    sys.exit(main())
