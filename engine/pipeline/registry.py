"""
STEP_REGISTRY — maps step_id strings (as stored in pipeline_steps.step_id)
to the class that implements that step.

Phase 7: Optional tools — cloud_enum, s3scanner, wafw00f. All mocks removed.
"""
from __future__ import annotations

from engine.pipeline.base import BaseStep

# ── Real implementations ───────────────────────────────────────────────────────
from engine.tools.subfinder        import SubfinderTool
from engine.tools.amass            import AmassTool
from engine.tools.tlsx             import TlsxTool
from engine.tools.assetfinder      import AssetfinderTool
from engine.tools.crtsh            import CrtShAction
from engine.tools.gau              import GauTool
from engine.tools.httpx            import HttpxTool
from engine.tools.naabu            import NaabuTool
from engine.tools.zgrab2           import ZGrab2ServiceTool
from engine.tools.nmap_service     import NmapServiceTool
from engine.tools.alterx           import AlterxTool
from engine.tools.puredns          import PureDnsTool
from engine.tools.cewl             import CewlTool
from engine.tools.katana           import KatanaTool
from engine.tools.subdomainizer    import SubdomainizerTool
from engine.tools.gowitness        import GoWitnessTool
from engine.tools.nuclei_takeover  import NucleiTakeoverTool
from engine.tools.cloud_enum       import CloudEnumTool
from engine.tools.s3scanner        import S3ScannerTool
from engine.tools.wafw00f          import Wafw00fTool
from engine.pipeline.consolidation import ConsolidateAction
from engine.pipeline.diff          import DiffAction
from engine.pipeline.wildcard      import WildcardCheckAction
from engine.pipeline.verify        import VerifyDedupAction

STEP_REGISTRY: dict[str, type[BaseStep]] = {
    # ── Passive enumeration — REAL (Phase 3/4) ─────────────────────────────────
    "subfinder":            SubfinderTool,      # REAL — Phase 3
    "amass":                AmassTool,          # REAL — Phase 4
    "tlsx":                 TlsxTool,           # REAL — Phase 4
    "assetfinder":          AssetfinderTool,    # REAL — Phase 4
    "crt_sh":               CrtShAction,        # REAL — Phase 4
    "gau":                  GauTool,            # REAL — Phase 4
    "cloud_enum":           CloudEnumTool,      # REAL — Phase 7
    "s3scanner":            S3ScannerTool,      # REAL — Phase 7
    "wafw00f":              Wafw00fTool,        # REAL — Phase 7

    # ── Wildcard detection — REAL (Phase 5) ────────────────────────────────────
    "wildcard_check":       WildcardCheckAction,  # REAL — Phase 5

    # ── DNS brute-force / resolution — REAL (Phase 5) ─────────────────────────
    "puredns_default":      PureDnsTool,        # REAL — Phase 5
    "alterx":               AlterxTool,         # REAL — Phase 5
    "puredns_permutation":  PureDnsTool,        # REAL — Phase 5
    "puredns_custom":       PureDnsTool,        # REAL — Phase 5
    "cewl":                 CewlTool,           # REAL — Phase 5

    # ── HTTP probing — REAL (Phase 4/5) ────────────────────────────────────────
    "httpx_r1":             HttpxTool,          # REAL — Phase 4
    "httpx_r2":             HttpxTool,          # REAL — Phase 4
    "httpx_r3":             HttpxTool,          # REAL — Phase 4

    # ── Port scanning — REAL (Phase 5) ─────────────────────────────────────────
    "naabu":                NaabuTool,          # REAL — Phase 5

    # ── Service fingerprinting — REAL (Phase 8) ─────────────────────────────────
    "zgrab2_service":       ZGrab2ServiceTool,  # default — fast async banner grab
    "nmap_service":         NmapServiceTool,    # alternative — thorough -sV detection

    # ── Non-standard port HTTP probe — REAL (Phase 8) ───────────────────────────
    "httpx_ports":          HttpxTool,          # probes HTTP/HTTPS ports from naabu → live_hosts

    # ── JS crawling — REAL (Phase 6) ───────────────────────────────────────────
    "katana":               KatanaTool,         # REAL — Phase 6
    "subdomainizer":        SubdomainizerTool,  # REAL — Phase 6

    # ── Takeover detection — REAL (Phase 6) ────────────────────────────────────
    "nuclei_takeover":      NucleiTakeoverTool, # REAL — Phase 6

    # ── Screenshots — REAL (Phase 6) ───────────────────────────────────────────
    "gowitness":            GoWitnessTool,      # REAL — Phase 6

    # ── Actions — REAL (Phase 3/4/6) ───────────────────────────────────────────
    "consolidate_r1":       ConsolidateAction,  # REAL — Phase 3
    "consolidate_r2":       ConsolidateAction,  # REAL — Phase 3
    "consolidate_r3":       ConsolidateAction,  # REAL — Phase 3
    "diff":                 DiffAction,         # REAL — Phase 4
    "verify_dedup":         VerifyDedupAction,  # REAL — Phase 6
}
