import { motion } from "framer-motion";
import {
  ExternalLink,
  Globe,
  Lock,
  AlertTriangle,
  Camera,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LiveHost } from "@/types/api";

interface HostCardProps {
  host: LiveHost;
  targetId: string;
  index: number;
  onClick?: () => void;
}

function statusTextColor(code: number | null): string {
  if (code === null) return "text-muted-foreground";
  if (code >= 200 && code < 300) return "text-sev-low";
  if (code >= 300 && code < 400) return "text-sev-info";
  if (code >= 400 && code < 500) return "text-sev-medium";
  if (code >= 500) return "text-sev-critical";
  return "text-muted-foreground";
}

function statusBgColor(code: number | null): string {
  if (code === null) return "bg-muted/30";
  if (code >= 200 && code < 300) return "bg-sev-low/15";
  if (code >= 300 && code < 400) return "bg-sev-info/15";
  if (code >= 400 && code < 500) return "bg-sev-medium/15";
  if (code >= 500) return "bg-sev-critical/15";
  return "bg-muted/30";
}

export function HostCard({ host, targetId, index, onClick }: HostCardProps) {
  const hasScreenshot = !!host.screenshot_path;
  const screenshotUrl = `/api/v1/targets/${targetId}/hosts/${host.id}/screenshot`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className={cn(
        "group flex flex-col rounded-lg border border-border bg-card overflow-hidden transition-[border-color,background-color] duration-200 hover:border-primary/40 hover:bg-surface-hover",
        onClick && "cursor-pointer",
      )}
    >
      {/* Screenshot or status placeholder */}
      <div className="relative h-36 overflow-hidden bg-muted/20">
        {hasScreenshot ? (
          <a
            href={screenshotUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src={screenshotUrl}
              alt={`Screenshot of ${host.url}`}
              className="h-full w-full object-cover object-top transition-transform group-hover:scale-[1.02]"
              loading="lazy"
            />
          </a>
        ) : (
          <div
            className={cn(
              "flex h-full w-full items-center justify-center",
              statusBgColor(host.status_code),
            )}
          >
            <span
              className={cn(
                "text-4xl font-semibold font-mono tabular-nums opacity-40",
                statusTextColor(host.status_code),
              )}
            >
              {host.status_code ?? "?"}
            </span>
          </div>
        )}

        {/* Status code pill overlay */}
        <div className="absolute top-2 right-2">
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold tabular-nums backdrop-blur-sm",
              "bg-black/50 border border-white/10",
              statusTextColor(host.status_code),
            )}
          >
            {host.status_code ?? "—"}
          </span>
        </div>

        {/* Screenshot indicator */}
        {hasScreenshot && (
          <div className="absolute top-2 left-2">
            <Camera className="h-3.5 w-3.5 text-white/60 drop-shadow" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        {/* URL */}
        <div className="flex items-center gap-1.5">
          {host.scheme === "https" ? (
            <Lock className="h-3 w-3 text-sev-low shrink-0" />
          ) : (
            <Globe className="h-3 w-3 text-sev-medium shrink-0" />
          )}
          <span className="font-mono text-xs text-foreground truncate flex-1">
            {host.url}
          </span>
          <a
            href={host.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {/* Title */}
        <p className="text-xs text-muted-foreground truncate">
          {host.title || "No title"}
        </p>

        {/* Tech badges */}
        {(host.tech ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {(host.tech ?? []).slice(0, 3).map((t) => (
              <span
                key={t}
                className="inline-flex items-center rounded bg-primary/10 px-1 py-0.5 text-[10px] font-mono text-primary"
              >
                {t}
              </span>
            ))}
            {(host.tech ?? []).length > 3 && (
              <span className="text-[10px] text-muted-foreground">
                +{(host.tech ?? []).length - 3}
              </span>
            )}
          </div>
        )}

        {/* Bottom row: security + meta */}
        <div className="mt-auto flex items-center justify-between pt-1 border-t border-border/50">
          {/* Security dots */}
          <div className="flex items-center gap-1.5">
            <SecurityDot label="CSP" ok={host.has_csp} />
            <SecurityDot label="HSTS" ok={host.has_hsts} />
            <SecurityDot label="XFO" ok={host.has_xfo} />
            {host.tls_expired && (
              <span title="TLS expired">
                <AlertTriangle className="h-3 w-3 text-sev-critical" />
              </span>
            )}
          </div>

          {/* Meta */}
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {host.webserver && (
              <span className="font-mono truncate max-w-[80px]">
                {host.webserver}
              </span>
            )}
            {host.response_time && (
              <span className="font-mono tabular-nums">
                {(host.response_time * 1000).toFixed(0)}ms
              </span>
            )}
          </div>
        </div>

        {/* CDN badge */}
        {host.cdn && (
          <span className="inline-flex self-start items-center rounded bg-sev-info/15 border border-sev-info/30 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-sev-info">
            CDN{host.cdn_name ? `: ${host.cdn_name}` : ""}
          </span>
        )}
      </div>
    </motion.div>
  );
}

function SecurityDot({ label, ok }: { label: string; ok: boolean | null }) {
  if (ok === null) return null;
  return (
    <span
      title={`${label}: ${ok ? "present" : "missing"}`}
      className="flex items-center gap-0.5"
    >
      <span
        className={cn(
          "led h-1.5 w-1.5 rounded-full",
          ok ? "text-sev-low" : "text-sev-medium",
        )}
        style={{ backgroundColor: "currentColor" }}
      />
      <span className="text-[9px] text-muted-foreground">{label}</span>
    </span>
  );
}
