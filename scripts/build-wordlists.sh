#!/bin/bash
# scripts/build-wordlists.sh
#
# Downloads and assembles all wordlists during Docker image build.
# See WORDLISTS.md for full sourcing details and rationale.
#
# This script is run as part of the Docker build process.
# It requires internet access at build time.

set -euo pipefail

DEST="/app/wordlists"
mkdir -p "$DEST/dns" "$DEST/dns-purpose" "$DEST/resolvers" "$DEST/patterns" "$DEST/custom"

# ---- Subdomain brute-force lists ----
echo "[+] Downloading subdomain brute-force lists..."

# small  — SecLists top-110K  (~110K words, ~37 min at 50 qps)
curl --retry 3 --retry-delay 2 -sL \
  "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/DNS/subdomains-top1million-110000.txt" \
  -o "$DEST/dns/dns-small.txt"

# medium — n0kovo subdomains_small  (~200K words, ~93 min at 50 qps)
curl --retry 3 --retry-delay 2 -sL \
  "https://raw.githubusercontent.com/n0kovo/n0kovo_subdomains/main/n0kovo_subdomains_small.txt" \
  -o "$DEST/dns/dns-medium.txt"

# large  — n0kovo subdomains_huge   (~3M words, ~23 h at 50 qps) — WARNING: very long runtime
curl --retry 3 --retry-delay 2 -sL \
  "https://raw.githubusercontent.com/n0kovo/n0kovo_subdomains/main/n0kovo_subdomains_huge.txt" \
  -o "$DEST/dns/dns-large.txt"

# ---- Resolvers ----
echo "[+] Downloading resolvers..."

curl --retry 3 --retry-delay 2 -sL \
  "https://raw.githubusercontent.com/trickest/resolvers/main/resolvers.txt" \
  -o "$DEST/resolvers/resolvers.txt"

curl --retry 3 --retry-delay 2 -sL \
  "https://raw.githubusercontent.com/trickest/resolvers/main/resolvers-trusted.txt" \
  -o "$DEST/resolvers/resolvers-trusted.txt"

# ---- alterx permutation patterns ----
echo "[+] Downloading alterx permutation patterns..."

# Default: copy from installed alterx config, fall back to GitHub
cp "$HOME/.config/alterx/permutation_v0.0.1.yaml" "$DEST/patterns/patterns-default.yaml" 2>/dev/null || \
  curl --retry 3 --retry-delay 2 -sL \
    "https://raw.githubusercontent.com/projectdiscovery/alterx/main/permutations.yaml" \
    -o "$DEST/patterns/patterns-default.yaml"

# Download permutation word sources (used for patterns-aggressive + dns-internal)
curl --retry 3 --retry-delay 2 -sL \
  "https://gist.githubusercontent.com/six2dez/ffc2b14d283e8f8eff6ac83e20a3c4b4/raw" \
  -o /tmp/six2dez-perms.txt

curl --retry 3 --retry-delay 2 -sL \
  "https://raw.githubusercontent.com/infosec-au/altdns/master/words.txt" \
  -o /tmp/altdns-words.txt

curl --retry 3 --retry-delay 2 -sL \
  "https://raw.githubusercontent.com/cujanovic/goaltdns/master/words.txt" \
  -o /tmp/goaltdns-words.txt

# ---- Build purpose-specific and aggressive-patterns lists ----
echo "[+] Building custom purpose lists..."
python3 /app/scripts/build-purpose-lists.py \
  --seclists "$DEST/dns/dns-small.txt" \
  --altdns    /tmp/altdns-words.txt \
  --output-dir "$DEST/dns-purpose"

echo "[+] Building patterns-aggressive.yaml..."
python3 /app/scripts/build-aggressive-patterns.py \
  --base     "$DEST/patterns/patterns-default.yaml" \
  --six2dez  /tmp/six2dez-perms.txt \
  --altdns   /tmp/altdns-words.txt \
  --goaltdns /tmp/goaltdns-words.txt \
  --output   "$DEST/patterns/patterns-aggressive.yaml"

# Cleanup temp files
rm -f /tmp/six2dez-perms.txt /tmp/altdns-words.txt /tmp/goaltdns-words.txt

# ---- Summary ----
echo "[+] Wordlist build complete. Stats:"
find "$DEST" \( -name "*.txt" -o -name "*.yaml" \) | sort | while read -r f; do
  count=$(wc -l < "$f" 2>/dev/null || echo "?")
  size=$(du -sh "$f" 2>/dev/null | cut -f1 || echo "?")
  echo "  ${count} lines  ${size}  ${f}"
done
