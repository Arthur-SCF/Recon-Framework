"""
Prometheus metrics registry for RECON_APP.

Import this module anywhere to access the metric objects.
The custom CollectorRegistry avoids polluting with default Python process metrics.
"""
from prometheus_client import (
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
    CONTENT_TYPE_LATEST,
)

__all__ = [
    "REGISTRY",
    "generate_latest",
    "CONTENT_TYPE_LATEST",
    "active_scans",
    "queue_depth",
    "targets_total",
    "subdomains_total",
    "live_hosts_total",
    "ws_connections",
    "steps_total",
    "step_duration",
    "scan_duration",
]

REGISTRY = CollectorRegistry(auto_describe=True)

# ── Gauges — current state ─────────────────────────────────────────────────────
active_scans = Gauge(
    "recon_active_scans",
    "Currently running scans",
    registry=REGISTRY,
)
queue_depth = Gauge(
    "recon_queue_depth",
    "Manual scan queue length",
    registry=REGISTRY,
)
targets_total = Gauge(
    "recon_targets_total",
    "Total targets in database",
    registry=REGISTRY,
)
subdomains_total = Gauge(
    "recon_subdomains_total",
    "Total subdomains across all targets",
    registry=REGISTRY,
)
live_hosts_total = Gauge(
    "recon_live_hosts_total",
    "Total live hosts across all targets",
    registry=REGISTRY,
)
ws_connections = Gauge(
    "recon_websocket_connections",
    "Active WebSocket connections",
    registry=REGISTRY,
)

# ── Counters — cumulative events ───────────────────────────────────────────────
steps_total = Counter(
    "recon_steps_total",
    "Step executions by step and status",
    ["step_id", "status"],
    registry=REGISTRY,
)

# ── Histograms — distributions ─────────────────────────────────────────────────
step_duration = Histogram(
    "recon_step_duration_seconds",
    "Step execution time in seconds",
    ["step_id"],
    buckets=[1, 5, 15, 30, 60, 120, 300, 600],
    registry=REGISTRY,
)
scan_duration = Histogram(
    "recon_scan_duration_seconds",
    "Full scan duration in seconds",
    buckets=[60, 300, 600, 1800, 3600, 7200],
    registry=REGISTRY,
)
