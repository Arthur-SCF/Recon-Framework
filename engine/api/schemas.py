import re
from typing import Literal

from pydantic import BaseModel, field_validator, model_validator

ScheduleMode = Literal["hourly", "daily", "weekly"]

# ── Health ────────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    db: bool
    uptime: float


class ErrorResponse(BaseModel):
    error: str          # machine-readable code: "not_found", "conflict", "internal_error"
    detail: str         # human-readable explanation
    status: int         # HTTP status code (mirrors the response status)
    request_id: str     # from X-Request-ID header, for log correlation


# ── Targets ───────────────────────────────────────────────────────────────────

_DOMAIN_RE = re.compile(
    r"^(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$"
)

WILDCARD_POLICIES = {"skip", "force", "ask"}


class TargetCreate(BaseModel):
    domain: str
    scan_priority: int = 5
    rescan_interval: int = 24
    manual_only: bool = False
    loop: bool = False
    wildcard_policy: str = "skip"
    retention_runs: int = 5
    pipeline_template: str = "standard"
    schedule_mode: ScheduleMode = "hourly"
    schedule_days: int = 1
    schedule_weekday: int = 0
    schedule_hour: int = 0
    schedule_minute: int = 0

    @field_validator("domain")
    @classmethod
    def validate_domain(cls, v: str) -> str:
        v = v.strip().lower().removeprefix("https://").removeprefix("http://").rstrip("/")
        if not _DOMAIN_RE.match(v):
            raise ValueError("Invalid domain name")
        if len(v) > 253:
            raise ValueError("Domain too long (max 253 chars)")
        return v

    @field_validator("scan_priority")
    @classmethod
    def validate_priority(cls, v: int) -> int:
        if not 1 <= v <= 10:
            raise ValueError("scan_priority must be 1–10")
        return v

    @field_validator("wildcard_policy")
    @classmethod
    def validate_wildcard(cls, v: str) -> str:
        if v not in WILDCARD_POLICIES:
            raise ValueError(f"wildcard_policy must be one of {WILDCARD_POLICIES}")
        return v

    @field_validator("retention_runs")
    @classmethod
    def validate_retention(cls, v: int) -> int:
        if v < 1:
            raise ValueError("retention_runs must be >= 1")
        return v

    @field_validator("schedule_weekday")
    @classmethod
    def validate_weekday(cls, v: int) -> int:
        if not 0 <= v <= 6:
            raise ValueError("schedule_weekday must be 0–6 (0=Monday)")
        return v

    @field_validator("schedule_hour")
    @classmethod
    def validate_hour(cls, v: int) -> int:
        if not 0 <= v <= 23:
            raise ValueError("schedule_hour must be 0–23")
        return v

    @field_validator("schedule_minute")
    @classmethod
    def validate_minute(cls, v: int) -> int:
        if not 0 <= v <= 59:
            raise ValueError("schedule_minute must be 0–59")
        return v

    @model_validator(mode="after")
    def check_scan_mode(self) -> "TargetCreate":
        if self.loop and self.manual_only:
            raise ValueError("loop and manual_only are mutually exclusive")
        return self


class TargetUpdate(BaseModel):
    scan_priority: int | None = None
    rescan_interval: int | None = None
    manual_only: bool | None = None
    loop: bool | None = None
    wildcard_policy: str | None = None
    retention_runs: int | None = None
    tags: list[str] | None = None
    schedule_mode: ScheduleMode | None = None
    schedule_days: int | None = None
    schedule_weekday: int | None = None
    schedule_hour: int | None = None
    schedule_minute: int | None = None
    pause_on_failure: bool | None = None

    @field_validator("scan_priority")
    @classmethod
    def validate_priority(cls, v: int | None) -> int | None:
        if v is not None and not 1 <= v <= 10:
            raise ValueError("scan_priority must be 1–10")
        return v

    @field_validator("wildcard_policy")
    @classmethod
    def validate_wildcard(cls, v: str | None) -> str | None:
        if v is not None and v not in WILDCARD_POLICIES:
            raise ValueError(f"wildcard_policy must be one of {WILDCARD_POLICIES}")
        return v

    @field_validator("schedule_weekday")
    @classmethod
    def validate_weekday(cls, v: int | None) -> int | None:
        if v is not None and not 0 <= v <= 6:
            raise ValueError("schedule_weekday must be 0–6 (0=Monday)")
        return v

    @field_validator("schedule_hour")
    @classmethod
    def validate_hour(cls, v: int | None) -> int | None:
        if v is not None and not 0 <= v <= 23:
            raise ValueError("schedule_hour must be 0–23")
        return v

    @field_validator("schedule_minute")
    @classmethod
    def validate_minute(cls, v: int | None) -> int | None:
        if v is not None and not 0 <= v <= 59:
            raise ValueError("schedule_minute must be 0–59")
        return v

    @model_validator(mode="after")
    def check_scan_mode(self) -> "TargetUpdate":
        if self.loop and self.manual_only:
            raise ValueError("loop and manual_only are mutually exclusive")
        return self


class TargetOut(BaseModel):
    id: str
    domain: str
    status: str
    created_at: str
    last_scan_at: str | None
    scan_count: int
    retention_runs: int
    scan_priority: int
    rescan_interval: int
    manual_only: bool
    loop: bool
    wildcard_policy: str
    pipeline_template: str = "standard"
    tags: list[str] = []
    schedule_mode: ScheduleMode = "hourly"
    schedule_days: int = 1
    schedule_weekday: int = 0
    schedule_hour: int = 0
    schedule_minute: int = 0
    pause_on_failure: bool = False


# ── Scope Rules ───────────────────────────────────────────────────────────────

SCOPE_RULE_TYPES = {"include", "exclude"}


class ScopeRuleCreate(BaseModel):
    rule_type: str
    pattern: str
    priority: int = 0

    @field_validator("rule_type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in SCOPE_RULE_TYPES:
            raise ValueError(f"rule_type must be one of {SCOPE_RULE_TYPES}")
        return v

    @field_validator("pattern")
    @classmethod
    def validate_pattern(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 253:
            raise ValueError("pattern must be 1–253 chars")
        return v


class ScopeRuleUpdate(BaseModel):
    rule_type: str | None = None
    pattern: str | None = None
    priority: int | None = None

    @field_validator("rule_type")
    @classmethod
    def validate_type(cls, v: str | None) -> str | None:
        if v is not None and v not in SCOPE_RULE_TYPES:
            raise ValueError(f"rule_type must be one of {SCOPE_RULE_TYPES}")
        return v

    @field_validator("pattern")
    @classmethod
    def validate_pattern(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not v or len(v) > 253:
                raise ValueError("pattern must be 1–253 chars")
        return v


class ScopeRuleOut(BaseModel):
    id: str
    target_id: str
    rule_type: str
    pattern: str
    priority: int
    created_at: str


# ── Notifications ─────────────────────────────────────────────────────────────

class NotificationOut(BaseModel):
    id: str
    target_id: str | None
    session_id: str | None
    type: str
    title: str
    message: str | None
    data: dict | None
    is_read: bool
    created_at: str


# ── API Keys ──────────────────────────────────────────────────────────────────

class ApiKeyCreate(BaseModel):
    service: str
    key_name: str | None = None
    key_value: str  # plaintext — will be encrypted before storage

    @field_validator("service")
    @classmethod
    def validate_service(cls, v: str) -> str:
        v = v.strip().lower()
        if not v or len(v) > 64:
            raise ValueError("service name must be 1–64 chars")
        return v

    @field_validator("key_value")
    @classmethod
    def validate_key_value(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("key_value cannot be empty")
        if len(v) > 1024:
            raise ValueError("key_value too long")
        return v


class ApiKeyOut(BaseModel):
    id: str
    service: str
    key_name: str | None
    created_at: str
    updated_at: str
    # key_value is intentionally NEVER included


# ── Settings — Telegram ───────────────────────────────────────────────────────

class TelegramSettingsIn(BaseModel):
    enabled: bool = False
    bot_token: str | None = None   # plaintext — encrypted on write; None = keep existing
    chat_id: str | None = None
    notify_new_hosts: bool = True
    notify_host_changes: bool = True
    notify_scan_complete: bool = True
    notify_errors: bool = True
    notify_host_gone: bool = True
    notify_host_returned: bool = True
    notify_new_subdomains: bool = True
    notify_takeover: bool = True
    notify_system: bool = True
    notify_step_errors: bool = True
    commands_enabled: bool = False

    @field_validator("chat_id")
    @classmethod
    def validate_chat_id(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not v:
                return None
        return v


class TelegramSettingsOut(BaseModel):
    enabled: bool
    has_token: bool       # True if a token is configured — never return the token itself
    chat_id: str | None
    notify_new_hosts: bool
    notify_host_changes: bool
    notify_scan_complete: bool
    notify_errors: bool
    notify_host_gone: bool
    notify_host_returned: bool
    notify_new_subdomains: bool
    notify_takeover: bool
    notify_system: bool
    notify_step_errors: bool
    commands_enabled: bool = False


# ── Scan Sessions ──────────────────────────────────────────────────────────────

class ScanSessionOut(BaseModel):
    id:            str
    target_id:     str
    started_at:    str
    finished_at:   str | None
    status:        str
    current_step:  str | None
    paused_at:     str | None
    pause_type:    str | None
    stats:         dict | None


class StepRunOut(BaseModel):
    id:             str
    session_id:     str
    target_id:      str
    step_id:        str
    tool_id:        str
    status:         str
    command:        list[str] | None
    stderr_snippet: str | None
    result_count:   int | None
    started_at:     str | None
    finished_at:    str | None
    execution_time: float | None
    error_category: str | None = None
    retry_count:    int        = 0


# ── Pipeline Config ────────────────────────────────────────────────────────────

class PipelineResetBody(BaseModel):
    template_name: str | None = None


class PipelineStepOut(BaseModel):
    id:               str
    group_id:         str
    target_id:        str
    position:         int
    step_id:          str
    enabled:          bool
    config_overrides: dict | None
    skippable:        bool = True


class PipelineGroupOut(BaseModel):
    id:        str
    target_id: str
    position:  int
    name:      str
    parallel:  bool
    enabled:   bool
    steps:     list[PipelineStepOut]


class PipelineGroupUpdate(BaseModel):
    enabled:  bool | None = None
    parallel: bool | None = None


class PipelineStepUpdate(BaseModel):
    enabled:          bool | None = None
    config_overrides: dict | None = None


# ── Backup ────────────────────────────────────────────────────────────────────

class BackupEntry(BaseModel):
    filename:   str
    size_bytes: int
    created_at: str   # "YYYYMMDD_HHMMSS"


# ── Tool Health ────────────────────────────────────────────────────────────────

class ToolHealthOut(BaseModel):
    step_id:          str
    name:             str
    installed:        bool
    version:          str | None
    latest_version:   str | None = None
    update_available: bool = False
    path:             str | None
    error:            str | None
    checked_at:       str


# ── General Settings ──────────────────────────────────────────────────────────

class GeneralSettingsOut(BaseModel):
    disk_pause_threshold: float
    scheduler_mode: str  # "sequential" | "priority"


class GeneralSettingsIn(BaseModel):
    disk_pause_threshold: float | None = None
    scheduler_mode: str | None = None

    @field_validator("disk_pause_threshold")
    @classmethod
    def validate_threshold(cls, v: float | None) -> float | None:
        if v is not None and not (50.0 <= v <= 99.0):
            raise ValueError("disk_pause_threshold must be between 50 and 99")
        return v

    @field_validator("scheduler_mode")
    @classmethod
    def validate_mode(cls, v: str | None) -> str | None:
        if v is not None and v not in ("sequential", "priority"):
            raise ValueError("scheduler_mode must be 'sequential' or 'priority'")
        return v


# ── Storage Stats ──────────────────────────────────────────────────────────────

class StorageTargetEntry(BaseModel):
    domain: str
    used_bytes: int


class StorageStatsOut(BaseModel):
    total_bytes: int
    used_bytes: int
    free_bytes: int
    used_pct: float
    targets: list[StorageTargetEntry]


# ── Live Hosts ─────────────────────────────────────────────────────────────────

class LiveHostOut(BaseModel):
    id:             str
    target_id:      str
    subdomain_id:   str | None
    url:            str
    status_code:    int | None
    title:          str | None
    content_length: int | None
    content_type:   str | None
    webserver:      str | None
    tech:           list[str] | None
    host:           str | None
    port:           int | None
    scheme:         str | None
    final_url:      str | None
    # TLS
    tls_version:    str | None
    tls_cipher:     str | None
    tls_subject_cn: str | None
    tls_issuer:     str | None
    tls_not_before: str | None
    tls_not_after:  str | None
    tls_self_signed: bool | None
    tls_expired:    bool | None
    tls_mismatched: bool | None
    # DNS
    cname:          str | None
    cdn:            bool | None
    cdn_name:       str | None
    a_records:      list[str] | None
    aaaa_records:   list[str] | None
    # Response
    response_hash:  str | None
    response_time:  float | None
    # Security headers
    has_csp:        bool | None
    has_xfo:        bool | None
    has_xcto:       bool | None
    has_hsts:       bool | None
    # Tracking
    first_seen:     str
    last_seen:      str
    last_status:    int | None
    last_title:     str | None


# ── Diff History ───────────────────────────────────────────────────────────────

class DiffEventOut(BaseModel):
    id:           str
    live_host_id: str
    target_id:    str
    session_id:   str | None
    url:          str
    event_type:   str
    status_code:  int | None
    title:        str | None
    webserver:    str | None
    changes:      dict | None
    recorded_at:  str


# ── Pipeline Template CRUD ────────────────────────────────────────────────────

class PipelineTemplateCreate(BaseModel):
    name: str
    display_name: str
    description: str | None = None
    config: dict  # must contain "groups" key

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Template name is required")
        if len(v) > 80:
            raise ValueError("Template name too long (max 80 chars)")
        return v

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Display name is required")
        if len(v) > 80:
            raise ValueError("Display name too long (max 80 chars)")
        return v

    @field_validator("config")
    @classmethod
    def validate_config(cls, v: dict) -> dict:
        if "groups" not in v:
            raise ValueError("config must contain a 'groups' key")
        return v


class PipelineTemplateUpdate(BaseModel):
    display_name: str | None = None
    description: str | None = None
    config: dict | None = None

    @field_validator("config")
    @classmethod
    def validate_config(cls, v: dict | None) -> dict | None:
        if v is not None and "groups" not in v:
            raise ValueError("config must contain a 'groups' key")
        return v


class PipelineTemplateClone(BaseModel):
    name: str | None = None
    display_name: str | None = None


# ── Bulk Operations ───────────────────────────────────────────────────────────

class BulkTargetIds(BaseModel):
    ids: list[str]

    @field_validator("ids")
    @classmethod
    def validate_ids(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("ids must not be empty")
        if len(v) > 100:
            raise ValueError("Cannot operate on more than 100 targets at once")
        return v


_TAG_RE = re.compile(r"^[a-z0-9][a-z0-9\-_]*$")


class TagCreate(BaseModel):
    tag: str

    @field_validator("tag")
    @classmethod
    def validate_tag(cls, v: str) -> str:
        v = v.strip().lower()
        if not v:
            raise ValueError("tag cannot be empty")
        if len(v) > 32:
            raise ValueError("tag too long (max 32 chars)")
        if not _TAG_RE.match(v):
            raise ValueError("tag may only contain lowercase letters, digits, hyphens, and underscores")
        return v


# ── Webhook Channels ──────────────────────────────────────────────────────────

class WebhookChannelOut(BaseModel):
    id: str
    type: str
    name: str
    enabled: bool
    events: list[str]
    created_at: str


# ── Bulk Operations ───────────────────────────────────────────────────────────

class BulkImportBody(BaseModel):
    domains: list[str]
    pipeline_template: str = "standard"
    scan_priority: int = 5
    manual_only: bool = False
    tags: list[str] = []

    @field_validator("domains")
    @classmethod
    def validate_domains(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("domains list is empty")
        if len(v) > 500:
            raise ValueError("Cannot import more than 500 domains at once")
        return v

    @field_validator("scan_priority")
    @classmethod
    def validate_priority(cls, v: int) -> int:
        if not 1 <= v <= 10:
            raise ValueError("scan_priority must be 1–10")
        return v


# ── Report Schedules ──────────────────────────────────────────────────────────

class ReportScheduleCreate(BaseModel):
    name: str
    target_id: str | None = None
    frequency: Literal["daily", "weekly"]
    day_of_week: int | None = None   # 0-6, required if weekly
    hour: int = 9                    # 0-23 UTC
    channel_id: str | None = None    # None = all enabled channels
    enabled: bool = True

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 80:
            raise ValueError("name must be 1–80 chars")
        return v

    @field_validator("hour")
    @classmethod
    def validate_hour(cls, v: int) -> int:
        if not 0 <= v <= 23:
            raise ValueError("hour must be 0–23")
        return v

    @field_validator("day_of_week")
    @classmethod
    def validate_dow(cls, v: int | None) -> int | None:
        if v is not None and not 0 <= v <= 6:
            raise ValueError("day_of_week must be 0–6")
        return v


class ReportScheduleUpdate(BaseModel):
    name: str | None = None
    target_id: str | None = None
    frequency: Literal["daily", "weekly"] | None = None
    day_of_week: int | None = None
    hour: int | None = None
    channel_id: str | None = None
    enabled: bool | None = None

    @field_validator("hour")
    @classmethod
    def validate_hour(cls, v: int | None) -> int | None:
        if v is not None and not 0 <= v <= 23:
            raise ValueError("hour must be 0–23")
        return v

    @field_validator("day_of_week")
    @classmethod
    def validate_dow(cls, v: int | None) -> int | None:
        if v is not None and not 0 <= v <= 6:
            raise ValueError("day_of_week must be 0–6")
        return v


class ReportScheduleOut(BaseModel):
    id: str
    name: str
    target_id: str | None
    frequency: str
    day_of_week: int | None
    hour: int
    channel_id: str | None
    enabled: bool
    last_sent_at: str | None
    created_at: str
