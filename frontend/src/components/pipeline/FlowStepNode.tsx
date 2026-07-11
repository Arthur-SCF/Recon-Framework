import { motion, useAnimation } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  MinusCircle,
  Clock,
  FileText,
  RotateCw,
  Lock,
} from "lucide-react";
import { useEffect, useRef } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";
import type { PipelineStep, StepRun } from "@/types/api";

// Status icons — 16px, consistent sizing
const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Circle       className="h-4 w-4 text-muted-foreground/30" />,
  running: <Loader2      className="h-4 w-4 text-sev-info animate-spin" />,
  success: <CheckCircle2 className="h-4 w-4 text-sev-low" />,
  error:   <AlertCircle  className="h-4 w-4 text-sev-critical" />,
  timeout: <Clock        className="h-4 w-4 text-sev-medium" />,
  skipped: <MinusCircle  className="h-4 w-4 text-faint-foreground" />,
};

// Human-readable display name for each step_id
const STEP_LABEL: Record<string, string> = {
  // Passive enumeration
  subfinder:             "Subfinder",
  amass:                 "Amass",
  tlsx:                  "TLSx",
  assetfinder:           "AssetFinder",
  crt_sh:                "CRT.sh",
  gau:                   "GAU",
  cloud_enum:            "CloudEnum",
  s3scanner:             "S3Scanner",
  wafw00f:               "WAFw00f",
  // DNS
  wildcard_check:        "Wildcard Check",
  puredns_default:       "PureDNS",
  puredns_permutation:   "PureDNS",
  puredns_custom:        "PureDNS",
  alterx:                "AlterX",
  cewl:                  "CeWL",
  // HTTP probing
  httpx_r1:              "Httpx",
  httpx_r2:              "Httpx",
  httpx_r3:              "Httpx",
  httpx_ports:           "Httpx",
  // Port scanning & service detection
  naabu:                 "Naabu",
  zgrab2_service:        "ZGrab2",
  nmap_service:          "Nmap",
  // JS crawling
  katana:                "Katana",
  subdomainizer:         "SubDomainizer",
  // Takeover / screenshots
  nuclei_takeover:       "Nuclei",
  gowitness:             "GoWitness",
  // Internal actions
  consolidate_r1:        "Consolidate",
  consolidate_r2:        "Consolidate",
  consolidate_r3:        "Consolidate",
  diff:                  "Diff Engine",
  verify_dedup:          "Dedup Check",
};

// Optional secondary label shown below the tool name in muted text.
// Useful when the same tool appears multiple times (httpx ×4, puredns ×3…)
// or when the purpose isn't obvious from the tool name alone.
const STEP_SUBLABEL: Record<string, string> = {
  puredns_default:       "Default wordlist",
  puredns_permutation:   "Permutations",
  puredns_custom:        "Custom wordlist",
  httpx_r1:              "Round 1",
  httpx_r2:              "Round 2",
  httpx_r3:              "Round 3",
  httpx_ports:           "Non-standard ports",
  naabu:                 "Port discovery",
  zgrab2_service:        "Service fingerprinting",
  nmap_service:          "Service fingerprinting",
  nuclei_takeover:       "Takeover templates",
  consolidate_r1:        "R1",
  consolidate_r2:        "R2",
  consolidate_r3:        "R3",
};

// Result count qualifiers — only for steps where the count has non-obvious semantics.
// consolidate_*: cumulative total in-scope subdomains (not just this run)
// httpx_r2/r3: only newly-discovered subdomains are probed (not all)
// diff: sum of discovered + changed + gone events (not an absolute count)
const RESULT_QUALIFIER: Record<string, string> = {
  consolidate_r1:  "total",
  consolidate_r2:  "total",
  consolidate_r3:  "total",
  httpx_r2:        "new",
  httpx_r3:        "new",
  zgrab2_service:  "identified",
  nmap_service:    "identified",
  diff:            "changes",
};

// Error category → icon color
const ERROR_CATEGORY_COLOR: Record<string, string> = {
  config:    "text-sev-critical",
  resource:  "text-sev-high",
  transient: "text-sev-medium",
  timeout:   "text-sev-medium",
  upstream:  "text-muted-foreground",
  unknown:   "text-sev-critical",
};

// Human-readable category labels for tooltip
const ERROR_CATEGORY_LABEL: Record<string, string> = {
  config:    "Config error",
  resource:  "Resource error",
  transient: "Transient error",
  timeout:   "Timeout",
  upstream:  "Upstream dependency",
  unknown:   "Error",
};

// Left border + background tint — always reserve 3px border space to prevent layout shift
const STATUS_ROW: Record<string, string> = {
  pending: "border-l-transparent hover:bg-surface-hover",
  running: "border-l-sev-info bg-sev-info/[0.06] pipeline-step-running",
  success: "border-l-sev-low/40 bg-sev-low/[0.025]",
  error:   "border-l-sev-critical/60 bg-sev-critical/[0.05] hover:bg-sev-critical/[0.07]",
  timeout: "border-l-sev-medium/50 bg-sev-medium/[0.04] hover:bg-sev-medium/[0.06]",
  skipped: "border-l-transparent hover:bg-surface-hover",
};

function fmtTime(sec: number | null): string {
  if (sec === null) return "";
  if (sec < 60) return `${sec.toFixed(1)}s`;
  return `${Math.floor(sec / 60)}m${Math.round(sec % 60)}s`;
}

const shakeAnimation = {
  x: [0, -4, 4, -4, 4, 0],
  transition: { duration: 0.4 },
};

const successFlash = {
  boxShadow: [
    "0 0 0 0 color-mix(in srgb, var(--sev-low) 0%, transparent)",
    "0 0 0 3px color-mix(in srgb, var(--sev-low) 12%, transparent)",
    "0 0 0 0 color-mix(in srgb, var(--sev-low) 0%, transparent)",
  ],
  transition: { duration: 0.5 },
};

interface FlowStepNodeProps {
  step: PipelineStep;
  run: StepRun | undefined;
  onViewLog: (stepId: string) => void;
  onViewResults: (stepId: string) => void;
  onRerun: (stepId: string) => void;
  onSkip?: (stepId: string) => void;
  isActive?: boolean;
}

export function FlowStepNode({
  step,
  run,
  onViewLog,
  onViewResults,
  onRerun,
  onSkip,
  isActive,
}: FlowStepNodeProps) {
  const status = run?.status ?? "pending";
  const isLocked = !step.skippable;
  const done = ["success", "error", "timeout"].includes(status);
  const hasResults = done && run?.result_count != null && run.result_count > 0;
  const canSkip =
    step.skippable &&
    (run?.status === "running" || run?.status === "pending") &&
    !!isActive;

  // Only fire on status *transition* — not on every re-render (e.g. accordion expand)
  const controls = useAnimation();
  const prevStatus = useRef<string>("pending");
  useEffect(() => {
    if (prevStatus.current === status) return;
    prevStatus.current = status;
    if (status === "success") void controls.start(successFlash);
    if (status === "error")   void controls.start(shakeAnimation);
  }, [status, controls]);

  return (
    <motion.div
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 group cursor-default",
        "border-l-[3px] transition-colors duration-200",
        isLocked && status === "pending"
          ? "border-l-primary/20 bg-primary/[0.03]"
          : STATUS_ROW[status] ?? STATUS_ROW.pending,
        status === "skipped" && "opacity-50",
      )}
      animate={controls}
    >
      {/* Status icon — fixed 16px slot; error/timeout get category-aware color + retry badge + tooltip */}
      {(status === "error" || status === "timeout") ? (
        <Tooltip.Provider delayDuration={400}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span className="shrink-0 relative flex items-center justify-center w-4 h-4 cursor-help">
                <AlertCircle
                  className={cn(
                    "h-4 w-4",
                    ERROR_CATEGORY_COLOR[run?.error_category ?? "unknown"] ?? "text-sev-critical",
                  )}
                />
                {run?.retry_count != null && run.retry_count > 0 && (
                  <span
                    className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center
                               font-mono text-[8px] font-semibold tabular-nums leading-none bg-background border border-border rounded-full px-0.5"
                  >
                    {run.retry_count + 1}
                  </span>
                )}
              </span>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="right"
                className="z-50 max-w-[200px] rounded bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
              >
                <p className="font-medium">
                  {ERROR_CATEGORY_LABEL[run?.error_category ?? "unknown"] ?? "Error"}
                </p>
                {run?.retry_count != null && run.retry_count > 0 && (
                  <p className="text-muted-foreground">{run.retry_count + 1} attempts</p>
                )}
                <Tooltip.Arrow className="fill-popover" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      ) : (
        <span className="shrink-0 flex items-center justify-center w-4 h-4">
          {isLocked && status === "pending"
            ? <Lock className="h-3.5 w-3.5 text-primary/30" />
            : STATUS_ICON[status] ?? STATUS_ICON.pending}
        </span>
      )}

      {/* Step label + optional sublabel */}
      <span className="flex-1 flex flex-col min-w-0 gap-px">
        <span
          className={cn(
            "text-[13px] font-sans truncate",
            status === "pending" && isLocked  ? "text-foreground/45 font-normal"
            : status === "pending"            ? "text-muted-foreground/35 font-normal"
            : status === "running"            ? "text-sev-info font-medium"
            : status === "skipped"            ? "text-muted-foreground/30 line-through font-normal"
            : status === "error" || status === "timeout" ? "text-sev-critical/90 font-normal"
            : "text-foreground/65 font-normal",
          )}
        >
          {STEP_LABEL[step.step_id] ?? step.step_id}
        </span>
        {STEP_SUBLABEL[step.step_id] && (
          <span
            className={cn(
              "text-[10px] truncate",
              status === "pending" && isLocked ? "text-muted-foreground/35"
              : status === "pending" || status === "skipped" ? "text-muted-foreground/20"
              : "text-muted-foreground/35",
            )}
          >
            {STEP_SUBLABEL[step.step_id]}
          </span>
        )}
      </span>

      {/* Result count — only when non-zero */}
      {hasResults && (
        <span className="shrink-0 flex items-center gap-1">
          <span
            className="rounded-full px-2 py-px font-mono text-[10px] font-medium tabular-nums bg-primary/10 text-primary/70 cursor-pointer hover:bg-primary/20 transition-colors"
            onClick={() => onViewResults(step.step_id)}
          >
            {run!.result_count}
          </span>
          {RESULT_QUALIFIER[step.step_id] && (
            <span className="text-[9px] text-muted-foreground/35 font-normal">
              {RESULT_QUALIFIER[step.step_id]}
            </span>
          )}
        </span>
      )}
      {run?.result_count === 0 && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/20 tabular-nums">
          0
        </span>
      )}

      {/* Duration — fixed width, right-aligned */}
      {run?.execution_time != null ? (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground/30 tabular-nums w-12 text-right">
          {fmtTime(run.execution_time)}
        </span>
      ) : (
        <span className="shrink-0 w-12" />
      )}

      {/* Hover actions */}
      {done && (
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onViewLog(step.step_id)}
            className="rounded p-1 text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/30 transition-colors"
            title="View logs"
          >
            <FileText className="h-3 w-3" />
          </button>
          <button
            onClick={() => onRerun(step.step_id)}
            className="rounded p-1 text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/30 transition-colors"
            title="Rerun"
          >
            <RotateCw className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Skip button — only for skippable steps while scan is active */}
      {canSkip && (
        <button
          onClick={() => onSkip?.(step.step_id)}
          className="h-6 px-2 text-xs text-sev-medium hover:bg-sev-medium/10 rounded transition-colors shrink-0"
          title="Skip this step"
        >
          Skip
        </button>
      )}
    </motion.div>
  );
}
