/**
 * Static tooltip content for the Config tab.
 * Keys: step_id or "step_id:param_key"
 */
export const STEP_TOOLTIPS: Record<string, string> = {
  // ── Passive enumeration ────────────────────────────────────────────────
  subfinder:
    "Discovers subdomains using passive DNS sources (certificate logs, search engines, APIs). Fast and stealthy. Results feed Consolidate R1.",
  amass:
    "Passive subdomain enumeration using OSINT sources. Slower than subfinder but often finds unique results. Results feed Consolidate R1.",
  assetfinder:
    "Fast passive subdomain discovery using certificate and DNS APIs. Results feed Consolidate R1.",
  crt_sh:
    "Queries certificate transparency logs (crt.sh) for subdomains. Very reliable for TLS-registered subdomains.",
  gau:
    "Fetches known URLs from Wayback Machine and Common Crawl. Extracts subdomains from historical web archives.",
  tlsx:
    "Extracts subdomains from TLS certificates directly from live hosts. Good for finding internal/wildcard certs.",
  subdomainizer:
    "Crawls JavaScript files to extract hardcoded subdomains. Catches what DNS tools miss.",

  // ── Brute-force ────────────────────────────────────────────────────────
  puredns_default:
    "DNS brute-force: queries every word in the wordlist against the target domain. The longest step — results feed Consolidate R1.",
  alterx:
    "Generates subdomain permutations from discovered subdomains. e.g. api.example.com → api-v2.example.com. Results feed Consolidate R2.",
  cewl:
    "Scrapes words from the target website and uses them as custom brute-force seeds. Results feed Consolidate R2.",
  puredns_permutation:
    "Resolves the alterx permutation list — finds which generated subdomains actually exist. Results feed Consolidate R2.",
  puredns_custom:
    "Resolves the cewl word list against the target domain. Results feed Consolidate R2.",

  // ── Probing ────────────────────────────────────────────────────────────
  httpx_r1:
    "HTTP probing round 1 — probes all discovered subdomains. Detects live hosts, status codes, titles, tech stack.",
  httpx_r2:
    "HTTP probing round 2 — probes subdomains found after permutation/custom brute-force. Same as R1 but for newly discovered names.",
  httpx_r3:
    "HTTP probing round 3 — probes subdomains extracted from JavaScript by Katana.",
  httpx_ports:
    "HTTP probing on non-standard ports found by Naabu. Finds hidden APIs and admin panels.",

  // ── Port scanning ──────────────────────────────────────────────────────
  naabu:
    "Fast TCP port scanner — configurable range (top 1000 / 5000 / full 65535). Identifies open ports on live hosts for further probing.",

  // ── WAF detection ──────────────────────────────────────────────────────
  wafw00f:
    "Detects WAF/CDN presence on live hosts. Useful for scoping attacks and understanding defensive layers.",

  // ── Service fingerprinting ─────────────────────────────────────────────
  zgrab2_service:
    "Fast async service banner grabbing via ZGrab2. Identifies service versions on open ports without Nmap overhead.",
  nmap_service:
    "Thorough service version detection with Nmap -sV. Slower than ZGrab2 but more accurate for complex services.",

  // ── Cloud & Storage ────────────────────────────────────────────────────
  cloud_enum:
    "Enumerates cloud assets (AWS, Azure, GCP) tied to the target domain. Finds hosted services and storage.",
  s3scanner:
    "Checks for exposed AWS S3 buckets: bucket existence, public read, and public write access.",

  // ── Deep recon ─────────────────────────────────────────────────────────
  katana:
    "Active web crawler — follows links and extracts subdomains/endpoints from JavaScript. Results feed httpx R3.",
  gowitness:
    "Screenshots every live host. Useful for quick visual triage of large scopes.",
  nuclei_takeover:
    "Checks for subdomain takeover vulnerabilities using Nuclei's takeover templates.",

  // ── Internal actions (locked) ──────────────────────────────────────────
  consolidate_r1:
    "Internal: deduplicates and merges all passive/brute-force subdomain results before httpx R1. Always runs — takes <1s.",
  consolidate_r2:
    "Internal: deduplicates permutation results before httpx R2. Always runs — takes <1s.",
  consolidate_r3:
    "Internal: deduplicates JS-extracted subdomains before httpx R3. Always runs — takes <1s.",
  wildcard_check:
    "Internal: detects wildcard DNS responses to avoid false positives. Always runs — takes ~5s.",
  diff:
    "Internal: compares current scan results against the previous scan to emit discovered/changed/gone events. Always runs — takes <1s.",
  verify_dedup:
    "Internal: final deduplication pass across all result tables. Always runs — takes <1s.",
};

export const PARAM_TOOLTIPS: Record<string, string> = {
  // PureDNS Default
  "puredns_default:primary_wordlist":
    "Which brute-force wordlist to use. Small (~110K, ~51 min) is the safe default. Medium (~200K, ~93 min) covers more. Large (~3M, ~23h) — WARNING: extremely slow.",
  "puredns_default:puredns_rate_limit":
    "DNS queries per second sent to resolvers. Default: 20 (safe for home WiFi). " +
    "⚠️ Home WiFi warning: massdns retries unanswered queries, so the real packet rate is higher than this number. " +
    "Above ~30 qps on a home router you may see periodic internet outages (3-5 min blackouts) as the router's NAT connection-tracking table fills up. " +
    "Safe ranges: 15-25 qps on WiFi, 50-100 qps on wired/VPS.",

  "puredns_default:puredns_wildcard_batch":
    "How many subdomains puredns groups into a single wildcard-detection pass. Default: 25,000. " +
    "⚠️ This was the main cause of periodic home WiFi outages: the old default of 1,000,000 sent a massive burst of DNS queries all at once at scan startup, overwhelming the router in one shot. " +
    "Smaller values spread the wildcard checks evenly across the run (less bursty, router stays happy). " +
    "Larger values mean fewer wildcard passes total (slightly more accurate on some targets) but each pass is a bigger spike. " +
    "Safe ranges: 10,000–50,000 on home WiFi. On a VPS you can raise to 500,000+.",

  // PureDNS Resolve
  "puredns_permutation:puredns_resolve_rate_limit":
    "DNS resolution rate limit for permutation results. Default is 50 (home WiFi safe). Raise to 150+ on a VPS. No wildcard detection overhead here so it can be higher than bruteforce.",
  "puredns_custom:puredns_resolve_rate_limit":
    "DNS resolution rate limit for cewl-generated candidates. Default: 150.",

  // Alterx
  "alterx:pattern_file":
    "Which permutation pattern set to use. Default: standard patterns (~60 patterns). Aggressive: extended set with more combinations — generates more candidates but takes longer to resolve.",

  // HTTPX
  "httpx_r1:threads":
    "Number of concurrent HTTP probes. Higher = faster but more aggressive on the target server. Default: 50.",
  "httpx_r1:timeout":
    "Per-request timeout in seconds. Lower = faster scans but misses slow servers. Default: 10.",
  "httpx_r1:rate_limit":
    "Requests per second cap. Lower = more polite to the target. Default: 150.",
  "httpx_r2:threads": "Concurrent HTTP probes for round 2. Default: 50.",
  "httpx_r2:timeout": "Per-request timeout for round 2, seconds. Default: 10.",
  "httpx_r2:rate_limit": "Rate limit for round 2, req/s. Default: 150.",
  "httpx_r3:threads": "Concurrent HTTP probes for round 3 (JS subs). Default: 50.",
  "httpx_r3:timeout": "Per-request timeout for round 3, seconds. Default: 10.",
  "httpx_r3:rate_limit": "Rate limit for round 3, req/s. Default: 150.",
  "httpx_ports:threads": "Concurrent probes for non-standard port hosts. Default: 50.",
  "httpx_ports:timeout": "Per-request timeout for port probing, seconds. Default: 10.",
  "httpx_ports:rate_limit": "Rate limit for port probing, req/s. Default: 150.",

  // Naabu
  "naabu:top_ports":
    "Port range to scan. 1000 = top 1000 common ports. 5000 = top 5000. full = all 65535 (very slow).",
  "naabu:rate":
    "Packets per second for port scanning. Higher = faster but more noisy. Default: 1000.",

  // Katana
  "katana:depth":
    "Maximum crawl depth (link hops from the start URL). Higher = discovers more but takes much longer. Default: 3.",
  "katana:concurrency":
    "Parallel crawl goroutines. Higher = faster but more requests per second. Default: 10.",
  "katana:timeout":
    "Per-request timeout in seconds. Default: 10.",

  // Subfinder
  "subfinder:threads":
    "Number of concurrent source queries. Higher = faster enumeration. Default: 10.",
  "subfinder:timeout":
    "Timeout per source query in seconds. Some sources are slow — lower this to skip unresponsive ones. Default: 30.",

  // Per-tool timeout params (each uses a different config key and unit)
  "gowitness:gowitness_timeout":
    "How long to wait for a single screenshot before giving up. Default: 10s. " +
    "Increase if you're targeting slow servers or seeing many blank/failed screenshots.",
  "nuclei_takeover:timeout":
    "Total subprocess timeout for the entire nuclei run in seconds. Default: 600s (10 min). " +
    "Increase if scanning a very large number of hosts.",
  "cewl:timeout":
    "Total subprocess timeout for the entire cewl scrape in seconds. Default: 300s (5 min).",
  "subdomainizer:timeout":
    "Total subprocess timeout for subdomainizer in seconds. Default: 300s (5 min). " +
    "Increase for targets with many JavaScript files.",
  "amass:timeout_minutes":
    "Amass internal enumeration timeout in MINUTES. Default: 10 min. " +
    "Amass stops collecting new results after this time and exits cleanly. " +
    "Increase for thorough passive enumeration on large targets (30-60 min). " +
    "Note: there is also a 15-min subprocess safety net that hard-kills amass regardless.",
  "gau:gau_timeout":
    "Per-source HTTP request timeout in seconds. Default: 30s. " +
    "Applies to each Wayback/OTX/urlscan API call individually. " +
    "Lower = skips slow sources faster. Higher = fewer missed results from slow APIs.",
  "tlsx:timeout_per_host":
    "TLS handshake timeout per host in seconds. Default: 10s. " +
    "Increase if you're seeing many false negatives on slow or rate-limited hosts.",
  "assetfinder:timeout":
    "Total subprocess timeout for assetfinder in seconds. Default: 180s (3 min).",
  "crt_sh:timeout":
    "HTTP request timeout for the crt.sh API query in seconds. Default: 30s. " +
    "crt.sh can be slow — increase if you're getting timeout errors on large targets.",
};
