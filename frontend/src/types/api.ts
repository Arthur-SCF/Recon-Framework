// ── Targets ───────────────────────────────────────────────────────────────────

export type ScheduleMode = "hourly" | "daily" | "weekly";

export interface Target {
  id: string;
  domain: string;
  status: "idle" | "running" | "completed" | "paused" | "error" | "loop_stopped";
  created_at: string;
  last_scan_at: string | null;
  scan_count: number;
  retention_runs: number;
  scan_priority: number;
  rescan_interval: number;
  manual_only: boolean;
  loop: boolean;
  wildcard_policy: "skip" | "force" | "ask";
  pipeline_template: string;
  tags: string[];
  schedule_mode: ScheduleMode;
  schedule_days: number;
  schedule_weekday: number;
  schedule_hour: number;
  schedule_minute: number;
  pause_on_failure: boolean;
  program_id: string | null;
  config_source: "inherit" | "override";
}

export interface TargetCreate {
  domain: string;
  scan_priority?: number;
  rescan_interval?: number;
  manual_only?: boolean;
  loop?: boolean;
  wildcard_policy?: "skip" | "force" | "ask";
  retention_runs?: number;
  pipeline_template?: string;
  tags?: string[];
  schedule_mode?: ScheduleMode;
  schedule_days?: number;
  schedule_weekday?: number;
  schedule_hour?: number;
  schedule_minute?: number;
}

// ── Programs ──────────────────────────────────────────────────────────────────
export type NotifyScope = "program" | "asset";

export interface Program {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  notify_scope: NotifyScope;
  pipeline_template: string;
  scan_priority: number;
  rescan_interval: number;
  manual_only: boolean;
  loop: boolean;
  wildcard_policy: "skip" | "force" | "ask";
  retention_runs: number;
  schedule_mode: ScheduleMode;
  schedule_days: number;
  schedule_weekday: number;
  schedule_hour: number;
  schedule_minute: number;
  asset_count: number;
}

export interface ProgramCreate {
  name: string;
  description?: string;
  notify_scope?: NotifyScope;
  pipeline_template?: string;
  scan_priority?: number;
  rescan_interval?: number;
  manual_only?: boolean;
  loop?: boolean;
  wildcard_policy?: "skip" | "force" | "ask";
  retention_runs?: number;
  schedule_mode?: ScheduleMode;
  schedule_days?: number;
  schedule_weekday?: number;
  schedule_hour?: number;
  schedule_minute?: number;
}

export interface ProgramScanSession {
  id: string;
  program_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  asset_total: number;
  asset_done: number;
  stats: Record<string, number> | null;
}

export interface ProgramAsset {
  id: string;
  domain: string;
  status: string;
  config_source: "inherit" | "override";
  last_scan_at: string | null;
  scan_count: number;
}

export interface ProgramScanResult {
  program_session_id: string;
  queued: number;
  asset_total: number;
}

export interface ProgramAssignResult {
  assigned: number;
  not_found: string[];
}

export interface ProgramStats {
  totals: { assets: number; subdomains: number; hosts: number; takeovers: number };
  by_asset: { target_id: string; domain: string; subdomains: number; hosts: number }[];
  status_dist: { bucket: string; count: number }[];
}

// ── Scope Rules ───────────────────────────────────────────────────────────────
export interface ScopeRule {
  id: string;
  target_id: string;
  rule_type: "include" | "exclude";
  pattern: string;
  priority: number;
  created_at: string;
}

export interface ScopeRuleCreate {
  rule_type: "include" | "exclude";
  pattern: string;
  priority?: number;
}

// ── Notifications ─────────────────────────────────────────────────────────────
export interface Notification {
  id: string;
  target_id: string | null;
  session_id: string | null;
  type: string;
  title: string;
  message: string | null;
  data: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

// ── API Keys ──────────────────────────────────────────────────────────────────
export interface ApiKey {
  id: string;
  service: string;
  key_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiKeyCreate {
  service: string;
  key_name?: string;
  key_value: string;
}

// ── Telegram Settings ─────────────────────────────────────────────────────────
export interface TelegramSettings {
  enabled: boolean;
  has_token: boolean;
  chat_id: string | null;
  notify_new_hosts: boolean;
  notify_host_changes: boolean;
  notify_scan_complete: boolean;
  notify_errors: boolean;
  notify_host_gone: boolean;
  notify_new_subdomains: boolean;
  notify_takeover: boolean;
  commands_enabled: boolean;
}

export interface TelegramSettingsUpdate {
  enabled: boolean;
  bot_token?: string;
  chat_id?: string;
  notify_new_hosts: boolean;
  notify_host_changes: boolean;
  notify_scan_complete: boolean;
  notify_errors: boolean;
  notify_host_gone: boolean;
  notify_new_subdomains: boolean;
  notify_takeover: boolean;
  commands_enabled: boolean;
}

// ── Scan Sessions ──────────────────────────────────────────────────────────────
export interface ScanSession {
  id: string;
  target_id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "paused" | "completed" | "cancelled" | "error";
  current_step: string | null;
  paused_at: string | null;
  pause_type: string | null;
  stats: Record<string, number> | null;
}

export interface StepRun {
  id: string;
  session_id: string;
  target_id: string;
  step_id: string;
  tool_id: string;
  status: "pending" | "running" | "success" | "error" | "timeout" | "skipped";
  command: string[] | null;
  stderr_snippet: string | null;
  result_count: number | null;
  started_at: string | null;
  finished_at: string | null;
  execution_time: number | null;
  error_category?: string | null;
  retry_count?: number;
}

// ── Pipeline Config ────────────────────────────────────────────────────────────
export interface PipelineStep {
  id: string;
  group_id: string;
  target_id: string;
  position: number;
  step_id: string;
  enabled: boolean;
  config_overrides: Record<string, unknown> | null;
  skippable: boolean;
}

export interface PipelineGroup {
  id: string;
  target_id: string;
  position: number;
  name: string;
  parallel: boolean;
  enabled: boolean;
  steps: PipelineStep[];
}

// ── Live Hosts ─────────────────────────────────────────────────────────────────
export interface LiveHost {
  id: string;
  target_id: string;
  asset_domain?: string;
  subdomain_id: string | null;
  url: string;
  status_code: number | null;
  title: string | null;
  content_length: number | null;
  content_type: string | null;
  webserver: string | null;
  tech: string[] | null;
  host: string | null;
  port: number | null;
  scheme: string | null;
  final_url: string | null;
  tls_version: string | null;
  tls_cipher: string | null;
  tls_subject_cn: string | null;
  tls_issuer: string | null;
  tls_not_before: string | null;
  tls_not_after: string | null;
  tls_self_signed: boolean | null;
  tls_expired: boolean | null;
  tls_mismatched: boolean | null;
  cname: string | null;
  cdn: boolean | null;
  cdn_name: string | null;
  a_records: string[] | null;
  aaaa_records: string[] | null;
  response_hash: string | null;
  response_time: number | null;
  has_csp: boolean | null;
  has_xfo: boolean | null;
  has_xcto: boolean | null;
  has_hsts: boolean | null;
  waf: string | null;
  first_seen: string;
  last_seen: string;
  last_status: number | null;
  last_title: string | null;
  screenshot_path: string | null;
}

export interface DiffEvent {
  id: string;
  live_host_id: string;
  target_id: string;
  session_id: string | null;
  url: string;
  event_type: "discovered" | "changed" | "gone" | "returned";
  status_code: number | null;
  title: string | null;
  webserver: string | null;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  recorded_at: string;
}

// ── Host History ───────────────────────────────────────────────────────────────
export interface HostHistoryEvent {
  id: string;
  live_host_id: string;
  session_id: string;
  url: string;
  event_type: "discovered" | "changed" | "gone" | "returned";
  status_code: number | null;
  title: string | null;
  webserver: string | null;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  recorded_at: string;
}

// ── Diff Compare ──────────────────────────────────────────────────────────────
export interface DiffCompareSessionInfo {
  id: string;
  started_at: string;
  finished_at: string | null;
  stats: Record<string, number> | null;
  counts: Partial<Record<string, number>>;
  new_subdomains: number;
  subdomain_total: number;
}

export interface DiffCompareResult {
  session_a: DiffCompareSessionInfo;
  session_b: DiffCompareSessionInfo;
  diff: {
    hosts_discovered_in_b: { url: string; status_code: number | null; title: string | null }[];
    hosts_gone_in_b:        { url: string }[];
    hosts_changed_in_b:     { url: string; changes: Record<string, { old: unknown; new: unknown }> }[];
  };
}

// ── Webhook Channels ──────────────────────────────────────────────────────────
export interface WebhookChannel {
  id: string;
  type: "discord" | "slack" | "generic";
  name: string;
  enabled: boolean;
  events: string[];
  created_at: string;
}

// ── General Settings ──────────────────────────────────────────────────────────
export interface GeneralSettings {
  disk_pause_threshold: number;
  scheduler_mode: "sequential" | "priority";
}

// ── Report Schedules ──────────────────────────────────────────────────────────
export interface ReportSchedule {
  id: string;
  name: string;
  target_id: string | null;
  frequency: "daily" | "weekly";
  day_of_week: number | null;
  hour: number;
  channel_id: string | null;
  enabled: boolean;
  last_sent_at: string | null;
  created_at: string;
}

// ── Tool Health ───────────────────────────────────────────────────────────────
export interface ToolHealth {
  step_id:          string;
  name:             string;
  installed:        boolean;
  version:          string | null;
  latest_version:   string | null;
  update_available: boolean;
  path:             string | null;
  error:            string | null;
  checked_at:       string;
}

// ── Backup ────────────────────────────────────────────────────────────────────
export interface BackupEntry {
  filename: string;
  size_bytes: number;
  created_at: string; // "YYYYMMDD_HHMMSS"
}

// ── Storage Stats ──────────────────────────────────────────────────────────────
export interface StorageStats {
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  used_pct: number;
  targets: { domain: string; used_bytes: number }[];
}

// ── Live Host Stats ────────────────────────────────────────────────────────────
export interface LiveHostStats {
  by_status_code: Record<string, number>;
}

// ── Subdomain Stats ────────────────────────────────────────────────────────────
export interface SubdomainStats {
  total: number;
  live: number;
  by_source: Record<string, number>;
  by_round: Record<string, number>;
}

// ── Paginated Response ────────────────────────────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

// ── Cloud Results ─────────────────────────────────────────────────────────────
export interface CloudAsset {
  id: string;
  url: string;
  asset_type: string;
  keyword: string | null;
  found_at: string;
}

export interface S3Bucket {
  id: string;
  bucket_name: string;
  region: string | null;
  bucket_exists: boolean;
  public_read: boolean;
  public_write: boolean;
  url: string | null;
  found_at: string;
}

export interface CloudResultsResponse {
  cloud_assets: PaginatedResponse<CloudAsset>;
  s3_buckets: PaginatedResponse<S3Bucket>;
}

// ── Available Steps (registry) ────────────────────────────────────────────────
export interface AvailableStep {
  step_id: string;
  label: string;
  category: string;
  description: string;
  skippable: boolean;
  is_action: boolean;
}

// ── Pipeline Templates ────────────────────────────────────────────────────────
export interface PipelineTemplate {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  is_default: boolean;
}

export interface PipelineTemplateFull extends PipelineTemplate {
  config: { groups: PipelineTemplateGroup[] };
}

export interface PipelineTemplateGroup {
  id: string;
  name: string;
  position: number;
  parallel: boolean;
  enabled: boolean;
  steps: PipelineTemplateStep[];
}

export interface PipelineTemplateStep {
  step_id: string;
  position: number;
  enabled: boolean;
  config_overrides?: Record<string, unknown>;
}
