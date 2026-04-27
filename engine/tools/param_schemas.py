"""
param_schemas.py — canonical parameter descriptors for every tool that exposes
config_overrides.

Each entry in STEP_PARAM_SCHEMAS maps a step_id to an ordered list of
ParamDescriptor dicts.  The frontend consumes this via:

    GET /api/v1/pipeline/steps/{step_id}/schema

The Pydantic validator in pipeline_config.py calls validate_overrides() to
reject unknown keys and coerce / range-check values before they are stored.

Buckets
-------
  basic    — shown inline by default; safe for all users
  advanced — hidden behind "Advanced" toggle; requires understanding
  danger   — shown in a danger accordion; requires explicit confirm in UI

Field types
-----------
  int / float  — numeric input with optional min/max/step
  bool         — checkbox / toggle
  string       — free-text input
  enum         — single-value select from options list
  csv          — comma-separated string (rendered as tag-input)
  kv           — key=value pairs (custom headers, etc.)
  textarea     — multi-line text
  secret       — masked input (never echoed in UI)
"""
from __future__ import annotations

from typing import Any, Literal, TypedDict

ParamType = Literal[
    "int", "float", "bool", "string", "enum", "csv", "kv", "textarea", "secret"
]
BucketType = Literal["basic", "advanced", "danger"]


class ParamDescriptor(TypedDict, total=False):
    key:       str                    # config_overrides key (required)
    label:     str                    # human-readable label (required)
    type:      ParamType              # field type (required)
    default:   Any                    # default value — must match type
    min:       float                  # numeric lower bound (inclusive)
    max:       float                  # numeric upper bound (inclusive)
    step:      float                  # numeric step for sliders
    unit:      str                    # display unit, e.g. "req/s", "sec"
    options:   list[str]              # valid values for enum type
    bucket:    BucketType             # disclosure tier (default: "basic")
    group:     str                    # visual grouping label within the form
    tooltip:   str                    # one-sentence explanation shown in UI
    cli_flag:  str                    # the CLI flag this maps to (doc only)
    required:  bool                   # whether the field must be present
    # Validation helpers used by validate_overrides()
    _int_cast: bool                   # coerce to int before storing (internal)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _p(
    key: str,
    label: str,
    type: ParamType,
    default: Any = None,
    *,
    min: float | None = None,
    max: float | None = None,
    step: float | None = None,
    unit: str = "",
    options: list[str] | None = None,
    bucket: BucketType = "basic",
    group: str = "",
    tooltip: str = "",
    cli_flag: str = "",
) -> ParamDescriptor:
    d: ParamDescriptor = {"key": key, "label": label, "type": type, "default": default}
    if min is not None:      d["min"] = min
    if max is not None:      d["max"] = max
    if step is not None:     d["step"] = step
    if unit:                 d["unit"] = unit
    if options is not None:  d["options"] = options
    if bucket != "basic":    d["bucket"] = bucket
    if group:                d["group"] = group
    if tooltip:              d["tooltip"] = tooltip
    if cli_flag:             d["cli_flag"] = cli_flag
    return d


# ---------------------------------------------------------------------------
# Per-tool schemas
# ---------------------------------------------------------------------------

_HTTPX: list[ParamDescriptor] = [
    _p("threads",        "Threads",          "int",   50,
       min=1, max=500, unit="threads",
       tooltip="Number of concurrent HTTP probe workers.",
       cli_flag="-threads"),
    _p("timeout_per_host", "Per-host timeout", "int",  10,
       min=1, max=120, unit="sec",
       tooltip="Seconds before an individual HTTP request is abandoned.",
       cli_flag="-timeout"),
    _p("timeout",        "Total timeout",    "int",  600,
       min=60, max=7200, unit="sec",
       bucket="advanced",
       tooltip="Wall-clock cap for the entire httpx run.",
       cli_flag="-timeout (outer)"),
    _p("retries",        "Retries",          "int",    1,
       min=0, max=5,
       bucket="advanced",
       tooltip="How many times to retry a failed request before giving up.",
       cli_flag="-retries"),
    _p("follow_redirects", "Follow redirects", "bool", False,
       bucket="advanced",
       tooltip="Follow HTTP redirects. Off by default — raw status codes are more informative for recon.",
       cli_flag="-fr"),
    _p("max_redirects",  "Max redirects",    "int",   10,
       min=1, max=20,
       bucket="advanced",
       tooltip="Maximum number of redirects to follow (only applies when follow_redirects is on).",
       cli_flag="-maxr"),
    _p("rate_limit",     "Rate limit",       "int",    0,
       min=0, max=50000, unit="req/s",
       bucket="danger",
       tooltip="Global requests-per-second cap. 0 = unlimited. Setting too low will make scans take much longer; setting too high can trigger WAFs or saturate the target.",
       cli_flag="-rl"),
    _p("custom_headers", "Custom headers",   "kv",    {},
       bucket="advanced",
       group="Request",
       tooltip="Extra HTTP headers to add to every request, e.g. Authorization or X-Bug-Bounty.",
       cli_flag="-H"),
]

_NAABU: list[ParamDescriptor] = [
    _p("top_ports",      "Top ports",        "enum",  "1000",
       options=["100", "1000", "full"],
       tooltip="Port range to scan. 'full' scans all 65535 ports and can take a very long time.",
       cli_flag="-top-ports"),
    _p("rate",           "Rate",             "int",  1000,
       min=10, max=20000, unit="pkts/s",
       tooltip="SYN probe packet rate. High values may trigger IDS/firewall blocks.",
       cli_flag="-rate"),
    _p("naabu_retries",  "Retries",          "int",    2,
       min=0, max=5,
       bucket="advanced",
       tooltip="Number of probe retries per port.",
       cli_flag="-retries"),
    _p("naabu_timeout",  "Probe timeout",    "int",    5,
       min=1, max=30, unit="sec",
       bucket="advanced",
       tooltip="Milliseconds naabu waits for a SYN-ACK before marking port as closed.",
       cli_flag="-timeout"),
    _p("timeout",        "Total timeout",    "int",  300,
       min=30, max=7200, unit="sec",
       bucket="advanced",
       tooltip="Wall-clock cap for the entire naabu run.",
       cli_flag="-timeout (outer)"),
    _p("exclude_ports",  "Exclude ports",    "csv",   "",
       bucket="advanced",
       tooltip="Comma-separated list of ports to skip, e.g. '22,25,445'.",
       cli_flag="-exclude-ports"),
    _p("skip_host_discovery", "Skip host discovery (Pn)", "bool", False,
       bucket="danger",
       tooltip="Treat all hosts as up — equivalent to nmap -Pn. Can cause many false-positive open-port results on unresponsive IPs.",
       cli_flag="-Pn"),
]

_SUBFINDER: list[ParamDescriptor] = [
    _p("threads",           "Threads",           "int",  10,
       min=1, max=100, unit="threads",
       tooltip="Number of concurrent source queries.",
       cli_flag="-t"),
    _p("timeout_per_source", "Per-source timeout", "int",  30,
       min=5, max=300, unit="sec",
       tooltip="Seconds before an individual passive source is abandoned.",
       cli_flag="-timeout"),
    _p("timeout",           "Total timeout",     "int",  300,
       min=30, max=7200, unit="sec",
       bucket="advanced",
       tooltip="Wall-clock cap for the entire subfinder run.",
       cli_flag="-timeout (outer)"),
]

_PUREDNS_DEFAULT: list[ParamDescriptor] = [
    _p("puredns_rate_limit", "Brute-force rate",  "int",   20,
       min=1, max=200, unit="req/s",
       tooltip="DNS query rate during the brute-force phase. Reduce on flaky resolvers.",
       cli_flag="--rate-limit"),
    _p("puredns_wildcard_batch", "Wildcard batch", "int", 25000,
       min=1000, max=100000,
       bucket="advanced",
       tooltip="Number of random subdomains probed per wildcard-detection pass.",
       cli_flag="--wildcard-batch"),
    _p("puredns_default_timeout", "Override total timeout", "int", 0,
       min=0, max=86400, unit="sec",
       bucket="advanced",
       tooltip="Override the auto-computed brute-force timeout. 0 = use dynamic estimate.",
       cli_flag="-timeout (outer)"),
]

_PUREDNS_RESOLVE: list[ParamDescriptor] = [
    _p("puredns_resolve_rate_limit", "Resolve rate", "int",  50,
       min=1, max=500, unit="req/s",
       tooltip="DNS query rate during permutation resolution. Higher is faster but more likely to hit resolver limits.",
       cli_flag="--rate-limit"),
    _p("puredns_wildcard_batch", "Wildcard batch", "int", 25000,
       min=1000, max=100000,
       bucket="advanced",
       tooltip="Number of random subdomains probed per wildcard-detection pass.",
       cli_flag="--wildcard-batch"),
]

_ALTERX: list[ParamDescriptor] = [
    _p("pattern_config", "Pattern set",    "enum",  "default",
       options=["default", "subdomains-only", "dns", "advanced"],
       tooltip="Which built-in alterx pattern set to expand. 'default' is a balanced mix; 'advanced' generates a much larger wordlist.",
       cli_flag="-p"),
    _p("timeout",        "Total timeout",  "int",   300,
       min=30, max=3600, unit="sec",
       bucket="advanced",
       tooltip="Wall-clock cap for alterx permutation generation.",
       cli_flag="-timeout (outer)"),
]

_KATANA: list[ParamDescriptor] = [
    _p("katana_depth",     "Crawl depth",     "int",   3,
       min=1, max=10,
       tooltip="Maximum link depth followed from each seed URL.",
       cli_flag="-depth"),
    _p("katana_concurrency", "Concurrency",   "int",  10,
       min=1, max=50, unit="workers",
       tooltip="Number of concurrent URL fetchers.",
       cli_flag="-concurrency"),
    _p("katana_rate_limit",  "Rate limit",    "int", 100,
       min=1, max=5000, unit="req/s",
       tooltip="Maximum requests per second across all crawlers.",
       cli_flag="-rate-limit"),
    _p("katana_parallelism", "Parallelism",   "int",   5,
       min=1, max=20,
       bucket="advanced",
       tooltip="Number of seed URLs processed in parallel (outer concurrency).",
       cli_flag="-parallelism"),
    _p("katana_crawl_duration", "Crawl duration override", "int", 0,
       min=0, max=3600, unit="sec",
       bucket="advanced",
       tooltip="Override the auto-computed crawl duration. 0 = 90% of total timeout.",
       cli_flag="-crawl-duration"),
    _p("timeout",           "Total timeout",  "int",  600,
       min=60, max=7200, unit="sec",
       bucket="advanced",
       tooltip="Wall-clock cap for the entire katana run.",
       cli_flag="-timeout (outer)"),
]

_GAU: list[ParamDescriptor] = [
    _p("gau_providers",  "Providers",     "csv",  "wayback,otx,urlscan",
       tooltip="Comma-separated list of passive URL sources. Available: wayback, otx, urlscan, commoncrawl.",
       cli_flag="--providers"),
    _p("threads",        "Threads",       "int",    2,
       min=1, max=20, unit="threads",
       tooltip="Concurrent provider queries.",
       cli_flag="--threads"),
    _p("gau_timeout",    "Per-provider timeout", "int", 30,
       min=5, max=300, unit="sec",
       bucket="advanced",
       tooltip="Seconds before an individual provider request is abandoned.",
       cli_flag="--timeout"),
    _p("timeout",        "Total timeout", "int",  300,
       min=30, max=7200, unit="sec",
       bucket="advanced",
       tooltip="Wall-clock cap for the entire gau run.",
       cli_flag="-timeout (outer)"),
]

_GOWITNESS: list[ParamDescriptor] = [
    _p("gowitness_threads",  "Threads",          "int",    4,
       min=1, max=20, unit="threads",
       tooltip="Number of concurrent headless browser instances.",
       cli_flag="--threads"),
    _p("gowitness_timeout",  "Per-page timeout", "int",   10,
       min=3, max=60, unit="sec",
       tooltip="Seconds a page has to load before gowitness gives up and takes a blank screenshot.",
       cli_flag="--timeout"),
    _p("gowitness_delay",    "Post-load delay",  "int",    1,
       min=0, max=10, unit="sec",
       bucket="advanced",
       tooltip="Seconds to wait after page load before capturing — useful for JS-heavy SPA pages.",
       cli_flag="--delay"),
    _p("timeout",            "Total timeout",    "int",  600,
       min=60, max=7200, unit="sec",
       bucket="advanced",
       tooltip="Wall-clock cap for the entire gowitness run.",
       cli_flag="-timeout (outer)"),
]

_NUCLEI_TAKEOVER: list[ParamDescriptor] = [
    _p("nuclei_rate_limit",  "Rate limit",   "int",  100,
       min=1, max=1000, unit="req/s",
       tooltip="Maximum HTTP requests per second sent to targets.",
       cli_flag="-rate-limit"),
    _p("nuclei_bulk_size",   "Bulk size",    "int",   50,
       min=1, max=500,
       bucket="advanced",
       tooltip="Number of targets batched per template execution round.",
       cli_flag="-bulk-size"),
    _p("nuclei_concurrency", "Concurrency",  "int",   25,
       min=1, max=200,
       bucket="advanced",
       tooltip="Number of concurrent template executions.",
       cli_flag="-concurrency"),
    _p("timeout",            "Total timeout", "int", 600,
       min=60, max=7200, unit="sec",
       bucket="advanced",
       tooltip="Wall-clock cap for the entire nuclei run.",
       cli_flag="-timeout (outer)"),
    _p("max_host_error",     "Max host errors", "int", 30,
       min=0, max=500,
       bucket="advanced",
       tooltip="Stop sending requests to a host after this many consecutive errors.",
       cli_flag="-max-host-error"),
]

_CLOUD_ENUM: list[ParamDescriptor] = [
    _p("cloud_enum_disable_aws",   "Disable AWS",   "bool", False,
       tooltip="Skip all AWS/S3 checks.",
       cli_flag="-disable-aws"),
    _p("cloud_enum_disable_azure", "Disable Azure", "bool", False,
       tooltip="Skip all Azure checks.",
       cli_flag="-disable-azure"),
    _p("cloud_enum_disable_gcp",   "Disable GCP",   "bool", False,
       tooltip="Skip all Google Cloud checks.",
       cli_flag="-disable-gcp"),
    _p("cloud_enum_quickscan",     "Quick scan",    "bool", True,
       bucket="advanced",
       tooltip="Use a smaller, faster keyword list. Disable for comprehensive coverage at the cost of speed.",
       cli_flag="--quickscan"),
    _p("cloud_enum_threads",       "Threads",       "int",   20,
       min=1, max=100, unit="threads",
       bucket="advanced",
       tooltip="Concurrent cloud storage probe workers.",
       cli_flag="-t"),
    _p("timeout",                  "Total timeout", "int",  300,
       min=30, max=7200, unit="sec",
       bucket="advanced",
       tooltip="Wall-clock cap for the entire cloud_enum run.",
       cli_flag="-timeout (outer)"),
]

_ZGRAB2: list[ParamDescriptor] = [
    _p("zgrab2_senders",  "Senders",       "int",  100,
       min=1, max=1000, unit="workers",
       tooltip="Number of concurrent zgrab2 connection workers.",
       cli_flag="--senders"),
    _p("timeout",         "Total timeout", "int",  600,
       min=60, max=7200, unit="sec",
       bucket="advanced",
       tooltip="Wall-clock cap for the entire zgrab2 run.",
       cli_flag="-timeout (outer)"),
    _p("zgrab2_read_timeout", "Read timeout", "int", 10,
       min=1, max=120, unit="sec",
       bucket="advanced",
       tooltip="Per-connection read timeout passed to each zgrab2 scanner.",
       cli_flag="--read-timeout"),
]

# GenericTimeoutParams tools — timeout only (some have a few extra keys)
_CEWL: list[ParamDescriptor] = [
    _p("cewl_depth",      "Crawl depth",   "int",   2,
       min=1, max=10,
       tooltip="Link depth cewl will follow from the root URL.",
       cli_flag="-d"),
    _p("cewl_min_length", "Min word length", "int", 5,
       min=2, max=20,
       tooltip="Minimum character length for a word to be included in the list.",
       cli_flag="-m"),
    _p("timeout",         "Total timeout", "int",  300,
       min=30, max=3600, unit="sec",
       bucket="advanced",
       tooltip="Wall-clock cap for the entire cewl run.",
       cli_flag="-timeout (outer)"),
]

_AMASS: list[ParamDescriptor] = [
    _p("timeout_minutes", "Timeout",       "int",  10,
       min=1, max=120, unit="min",
       tooltip="amass built-in timeout in minutes (-timeout flag). Amass is always sequential.",
       cli_flag="-timeout"),
]

_TLSX: list[ParamDescriptor] = [
    _p("timeout_per_host", "Per-host timeout", "int", 10,
       min=1, max=60, unit="sec",
       tooltip="Seconds before an individual TLS handshake is abandoned.",
       cli_flag="-timeout"),
    _p("timeout",          "Total timeout",    "int", 300,
       min=30, max=3600, unit="sec",
       bucket="advanced",
       tooltip="Wall-clock cap for the entire tlsx run.",
       cli_flag="-timeout (outer)"),
]

_NMAP_SERVICE: list[ParamDescriptor] = [
    _p("nmap_timing",     "Timing template", "enum",  "4",
       options=["0", "1", "2", "3", "4", "5"],
       tooltip="nmap -T<n> timing: 0=paranoid, 1=sneaky, 2=polite, 3=normal, 4=aggressive, 5=insane. T4 is the default.",
       cli_flag="-T"),
    _p("nmap_rate",       "Min rate",        "int",   0,
       min=0, max=10000, unit="pkts/s",
       bucket="advanced",
       tooltip="Minimum packet rate (--min-rate). 0 = use nmap default. High values improve speed but increase detection risk.",
       cli_flag="--min-rate"),
    _p("timeout",         "Total timeout",   "int", 2400,
       min=300, max=14400, unit="sec",
       bucket="advanced",
       tooltip="Wall-clock cap for the entire nmap_service run. nmap -sV is thorough and slow.",
       cli_flag="-timeout (outer)"),
]

# Generic timeout-only schema (used as fallback for tools with no specific schema)
_GENERIC_TIMEOUT: list[ParamDescriptor] = [
    _p("timeout",         "Total timeout",   "int",  300,
       min=30, max=7200, unit="sec",
       tooltip="Wall-clock cap for this tool's run.",
       cli_flag="-timeout (outer)"),
]


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

STEP_PARAM_SCHEMAS: dict[str, list[ParamDescriptor]] = {
    # httpx — all four rounds share the same schema
    "httpx_r1":            _HTTPX,
    "httpx_r2":            _HTTPX,
    "httpx_r3":            _HTTPX,
    "httpx_ports":         _HTTPX,
    # port scanning
    "naabu":               _NAABU,
    # passive enumeration
    "subfinder":           _SUBFINDER,
    "amass":               _AMASS,
    "tlsx":                _TLSX,
    "assetfinder":         _GENERIC_TIMEOUT,
    "crt_sh":              _GENERIC_TIMEOUT,
    "s3scanner":           _GENERIC_TIMEOUT,
    "wafw00f":             _GENERIC_TIMEOUT,
    "subdomainizer":       _GENERIC_TIMEOUT,
    # DNS
    "puredns_default":     _PUREDNS_DEFAULT,
    "puredns_permutation": _PUREDNS_RESOLVE,
    "puredns_custom":      _PUREDNS_RESOLVE,
    "cewl":                _CEWL,
    # mutation
    "alterx":              _ALTERX,
    # JS crawl / URL
    "katana":              _KATANA,
    "gau":                 _GAU,
    # screenshots
    "gowitness":           _GOWITNESS,
    # service fingerprinting
    "zgrab2_service":      _ZGRAB2,
    "nmap_service":        _NMAP_SERVICE,
    # takeover
    "nuclei_takeover":     _NUCLEI_TAKEOVER,
    # cloud
    "cloud_enum":          _CLOUD_ENUM,
}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

class SchemaValidationError(ValueError):
    """Raised when config_overrides fails schema validation."""


def validate_overrides(step_id: str, overrides: dict) -> dict:
    """
    Validate and lightly coerce a config_overrides dict against the schema for
    step_id.

    Rules:
      1. Unknown keys raise SchemaValidationError (only when RECON_STRICT_CONFIG=1).
      2. Type coercion: string "123" → int 123 for int fields.
      3. Range check: min/max bounds enforced for numeric fields.
      4. Enum check: value must be in options list for enum fields.
      5. Bool coercion: 0/1/"true"/"false" → Python bool.

    Returns the coerced overrides dict.
    """
    import os
    schema = STEP_PARAM_SCHEMAS.get(step_id)
    if not schema:
        # No schema = accept anything (tools without param editors)
        return overrides

    strict = os.environ.get("RECON_STRICT_CONFIG", "0") == "1"
    by_key = {p["key"]: p for p in schema}
    coerced: dict = {}

    for k, v in overrides.items():
        if k not in by_key:
            if strict:
                raise SchemaValidationError(
                    f"Unknown config key {k!r} for step {step_id!r}. "
                    f"Valid keys: {sorted(by_key)}"
                )
            # In non-strict mode keep unknown keys (backward compat)
            coerced[k] = v
            continue

        desc = by_key[k]
        field_type = desc.get("type", "string")

        try:
            if field_type == "int":
                v = int(v)
            elif field_type == "float":
                v = float(v)
            elif field_type == "bool":
                if isinstance(v, str):
                    v = v.lower() in ("1", "true", "yes")
                else:
                    v = bool(v)
            elif field_type == "enum":
                v = str(v)
                opts = desc.get("options") or []
                if opts and v not in opts:
                    raise SchemaValidationError(
                        f"Invalid value {v!r} for {k!r} on step {step_id!r}. "
                        f"Must be one of: {opts}"
                    )
        except (ValueError, TypeError) as exc:
            raise SchemaValidationError(
                f"Type error for {k!r} on step {step_id!r}: {exc}"
            ) from exc

        # Range check
        if field_type in ("int", "float"):
            lo = desc.get("min")
            hi = desc.get("max")
            if lo is not None and v < lo:
                raise SchemaValidationError(
                    f"{k!r} = {v} is below minimum {lo} for step {step_id!r}"
                )
            if hi is not None and v > hi:
                raise SchemaValidationError(
                    f"{k!r} = {v} exceeds maximum {hi} for step {step_id!r}"
                )

        coerced[k] = v

    return coerced


def schema_for(step_id: str) -> list[ParamDescriptor]:
    """Return the param schema for step_id, or an empty list if none."""
    return STEP_PARAM_SCHEMAS.get(step_id, [])


def default_for(step_id: str, key: str) -> Any:
    """Return the default value for a single config key, or None if not in schema."""
    for p in STEP_PARAM_SCHEMAS.get(step_id, []):
        if p["key"] == key:
            return p.get("default")
    return None
