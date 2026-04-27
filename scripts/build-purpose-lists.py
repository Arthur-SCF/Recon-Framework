#!/usr/bin/env python3
"""
scripts/build-purpose-lists.py
Stub — full implementation in Phase 5 (wordlist system).
Builds purpose-specific subdomain wordlists from SecLists + altdns sources.
"""
import argparse
import os

parser = argparse.ArgumentParser()
parser.add_argument("--seclists")
parser.add_argument("--altdns")
parser.add_argument("--output-dir")
args = parser.parse_args()

os.makedirs(args.output_dir, exist_ok=True)

# Stub: create empty placeholder files so Phase 0 build succeeds.
# Phase 5 will implement real filtering logic.
for name in ("dns-internal.txt", "dns-cloud.txt", "dns-dev.txt", "dns-api.txt"):
    path = os.path.join(args.output_dir, name)
    with open(path, "w") as f:
        f.write("# placeholder — built by build-purpose-lists.py (Phase 5)\n")

print("[stub] build-purpose-lists.py: placeholder files created in", args.output_dir)
