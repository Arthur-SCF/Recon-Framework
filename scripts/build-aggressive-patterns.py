#!/usr/bin/env python3
"""
scripts/build-aggressive-patterns.py
Stub — full implementation in Phase 5 (wordlist system).
Merges multiple permutation word sources into an extended alterx YAML config.
"""
import argparse
import shutil

parser = argparse.ArgumentParser()
parser.add_argument("--base")
parser.add_argument("--six2dez")
parser.add_argument("--altdns")
parser.add_argument("--goaltdns")
parser.add_argument("--output")
args = parser.parse_args()

# Stub: copy the base patterns file as-is.
# Phase 5 will merge all word sources into an extended pattern set.
if args.base and args.output:
    shutil.copy(args.base, args.output)
    print("[stub] build-aggressive-patterns.py: copied base patterns to", args.output)
else:
    print("[stub] build-aggressive-patterns.py: no base file, skipping")
