import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  ExternalLink,
  Globe,
  Lock,
  Shield,
  ShieldOff,
  AlertTriangle,
  Copy,
  Check,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import type { LiveHost, HostHistoryEvent } from "@/types/api";

interface HostDetailPanelProps {
  host: LiveHost;
  targetId: string;
  onClose: () => void;
}

function statusColor(code: number | null) {
  if (code === null) return "text-muted-foreground bg-muted/30";
  if (code >= 200 && code < 300) return "text-sev-low bg-sev-low/15";
  if (code >= 300 && code < 400) return "text-sev-info bg-sev-info/15";
  if (code >= 400 && code < 500) return "text-sev-medium bg-sev-medium/15";
  if (code >= 500) return "text-sev-critical bg-sev-critical/15";
  return "text-muted-foreground bg-muted/30";
}

function eventBadge(type: HostHistoryEvent["event_type"]) {
  switch (type) {
    case "discovered": return "bg-sev-low/15 text-sev-low border-sev-low/30";
    case "changed":    return "bg-sev-medium/15 text-sev-medium border-sev-medium/30";
    case "gone":       return "bg-sev-critical/15 text-sev-critical border-sev-critical/30";
    case "returned":   return "bg-sev-info/15 text-sev-info border-sev-info/30";
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatBytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">
        {title}
      </p>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs text-foreground sm:text-right font-mono break-all">{value}</span>
    </div>
  );
}

function SecurityBadge({ label, ok }: { label: string; ok: boolean | null }) {
  if (ok === null) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide",
        ok
          ? "border-sev-low/30 bg-sev-low/15 text-sev-low"
          : "border-sev-medium/30 bg-sev-medium/15 text-sev-medium",
      )}
    >
      {ok ? <Shield className="h-2.5 w-2.5" /> : <ShieldOff className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-sev-low" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

interface PortEntry {
  host: string;
  port: number;
  service: string | null;
  protocol: string | null;
}

export function HostDetailPanel({ host, targetId, onClose }: HostDetailPanelProps) {
  const [history, setHistory] = useState<HostHistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [ports, setPorts] = useState<PortEntry[]>([]);
  const screenshotUrl = `/api/v1/targets/${targetId}/hosts/${host.id}/screenshot`;

  const hostname = host.host ?? host.url.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];

  useEffect(() => {
    setHistoryLoading(true);
    void fetch(`/api/v1/targets/${targetId}/hosts/${host.id}/history`)
      .then((r) => (r.ok ? (r.json() as Promise<HostHistoryEvent[]>) : []))
      .then((data) => {
        setHistory(data);
        setHistoryLoading(false);
      })
      .catch(() => setHistoryLoading(false));
  }, [host.id, targetId]);

  useEffect(() => {
    void fetch(
      `/api/v1/targets/${targetId}/ports?q=${encodeURIComponent(hostname)}&per_page=50`,
    )
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((res: { data?: PortEntry[] }) => setPorts(res.data ?? []))
      .catch(() => setPorts([]));
  }, [hostname, targetId]);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            "fixed right-0 top-0 z-50 h-full w-full max-w-xl",
            "flex flex-col border-l border-border bg-card shadow-2xl outline-none",
            "animate-in slide-in-from-right duration-200",
          )}
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 shrink-0">
            {host.scheme === "https" ? (
              <Lock className="h-3.5 w-3.5 text-sev-low shrink-0" />
            ) : (
              <Globe className="h-3.5 w-3.5 text-sev-medium shrink-0" />
            )}
            <span className="flex-1 truncate font-mono text-sm text-foreground">
              {host.url}
            </span>
            <span
              className={cn(
                "inline-flex shrink-0 rounded px-1.5 py-0.5 text-xs font-mono font-semibold tabular-nums",
                statusColor(host.status_code),
              )}
            >
              {host.status_code ?? "—"}
            </span>
            <CopyButton text={host.url} />
            <a
              href={`https://www.whois.com/whois/${hostname}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              title="Whois lookup"
            >
              <Search className="h-3.5 w-3.5" />
            </a>
            <a
              href={host.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              title="Open in browser"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Dialog.Close
              onClick={onClose}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Body (scrollable) */}
          <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">

            {/* TLS Certificate */}
            {host.tls_version && (
              <Section title="TLS Certificate">
                <div className="flex flex-wrap gap-1 mb-1">
                  <span className="inline-flex rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] font-mono text-foreground">
                    {host.tls_version}
                  </span>
                  {host.tls_cipher && (
                    <span className="inline-flex rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground truncate max-w-[200px]">
                      {host.tls_cipher}
                    </span>
                  )}
                  {host.tls_self_signed && (
                    <span className="inline-flex items-center gap-1 rounded border border-sev-critical/30 bg-sev-critical/15 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-sev-critical">
                      <AlertTriangle className="h-2.5 w-2.5" /> Self-signed
                    </span>
                  )}
                  {host.tls_expired && (
                    <span className="inline-flex items-center gap-1 rounded border border-sev-critical/30 bg-sev-critical/15 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-sev-critical">
                      <AlertTriangle className="h-2.5 w-2.5" /> Expired
                    </span>
                  )}
                  {host.tls_mismatched && (
                    <span className="inline-flex items-center gap-1 rounded border border-sev-high/30 bg-sev-high/15 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-sev-high">
                      <AlertTriangle className="h-2.5 w-2.5" /> CN mismatch
                    </span>
                  )}
                </div>
                {host.tls_subject_cn && <Row label="Subject CN" value={host.tls_subject_cn} />}
                {host.tls_issuer && <Row label="Issuer" value={host.tls_issuer} />}
                {host.tls_not_before && <Row label="Valid from" value={host.tls_not_before} />}
                {host.tls_not_after && <Row label="Expires" value={host.tls_not_after} />}
              </Section>
            )}

            {/* Security Headers */}
            <Section title="Security Headers">
              <div className="flex flex-wrap gap-1.5">
                <SecurityBadge label="CSP" ok={host.has_csp} />
                <SecurityBadge label="HSTS" ok={host.has_hsts} />
                <SecurityBadge label="X-Frame-Options" ok={host.has_xfo} />
                <SecurityBadge label="X-Content-Type" ok={host.has_xcto} />
              </div>
              {host.waf && (
                <Row
                  label="WAF"
                  value={
                    <span className="inline-flex rounded border border-sev-info/30 bg-sev-info/15 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-sev-info">
                      {host.waf}
                    </span>
                  }
                />
              )}
            </Section>

            {/* Network / DNS */}
            {(host.cname ?? host.cdn ?? (host.a_records?.length ?? 0) > 0) && (
              <Section title="Network / DNS">
                {host.cname && <Row label="CNAME" value={host.cname} />}
                {host.cdn && (
                  <Row
                    label="CDN"
                    value={
                      <span className="inline-flex rounded border border-sev-info/30 bg-sev-info/15 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-sev-info">
                        {host.cdn_name ?? "Yes"}
                      </span>
                    }
                  />
                )}
                {(host.a_records?.length ?? 0) > 0 && (
                  <Row
                    label="A records"
                    value={
                      <div className="flex flex-wrap justify-end gap-1">
                        {host.a_records!.map((ip) => (
                          <span
                            key={ip}
                            className="inline-flex rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] font-mono text-foreground"
                          >
                            {ip}
                          </span>
                        ))}
                      </div>
                    }
                  />
                )}
                {(host.aaaa_records?.length ?? 0) > 0 && (
                  <Row
                    label="AAAA records"
                    value={
                      <div className="flex flex-wrap justify-end gap-1">
                        {host.aaaa_records!.map((ip) => (
                          <span
                            key={ip}
                            className="inline-flex rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] font-mono text-foreground"
                          >
                            {ip}
                          </span>
                        ))}
                      </div>
                    }
                  />
                )}
              </Section>
            )}

            {/* Response */}
            <Section title="Response">
              {host.content_type && <Row label="Content-Type" value={host.content_type} />}
              <Row label="Content-Length" value={formatBytes(host.content_length)} />
              {host.response_time !== null && (
                <Row label="Response Time" value={`${(host.response_time * 1000).toFixed(0)} ms`} />
              )}
              {host.webserver && <Row label="Webserver" value={host.webserver} />}
              {host.response_hash && (
                <Row
                  label="Response Hash"
                  value={
                    <span className="inline-flex items-center">
                      {host.response_hash.slice(0, 12)}…
                      <CopyButton text={host.response_hash} />
                    </span>
                  }
                />
              )}
            </Section>

            {/* Tech Stack */}
            {(host.tech?.length ?? 0) > 0 && (
              <Section title="Tech Stack">
                <div className="flex flex-wrap gap-1">
                  {host.tech!.map((t) => (
                    <span
                      key={t}
                      className="inline-flex rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-mono text-primary"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {/* Screenshot */}
            {host.screenshot_path && (
              <Section title="Screenshot">
                <a
                  href={screenshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block overflow-hidden rounded-md border border-border hover:opacity-90 transition-opacity"
                >
                  <img
                    src={screenshotUrl}
                    alt={`Screenshot of ${host.url}`}
                    className="h-full w-full object-cover object-top"
                    loading="lazy"
                  />
                </a>
              </Section>
            )}

            {/* Open Ports */}
            {ports.length > 0 && (
              <Section title="Open Ports">
                <div className="flex flex-wrap gap-1.5">
                  {ports.map((p) => (
                    <span
                      key={`${p.host}:${p.port}`}
                      className="inline-flex items-center gap-1 rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] font-mono text-foreground"
                      title={p.service ?? undefined}
                    >
                      <span className="text-foreground tabular-nums">{p.port}</span>
                      {p.protocol && <span className="text-muted-foreground">/{p.protocol}</span>}
                      {p.service && <span className="text-muted-foreground"> {p.service}</span>}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {/* History */}
            <Section title="Change History">
              {historyLoading ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-3/4" />
                </div>
              ) : history.length === 0 ? (
                <p className="text-xs text-muted-foreground">No history recorded yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {history.map((evt) => (
                    <div
                      key={evt.id}
                      className="flex flex-col gap-1 rounded-md border border-border bg-muted/20 px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            "inline-flex rounded border px-1.5 py-0.5 text-[10px] font-mono capitalize",
                            eventBadge(evt.event_type),
                          )}
                        >
                          {evt.event_type}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {relativeTime(evt.recorded_at)}
                        </span>
                      </div>
                      {evt.changes && Object.keys(evt.changes).length > 0 && (
                        <div className="flex flex-col gap-0.5 pl-1 border-l-2 border-border">
                          {Object.entries(evt.changes).map(([field, diff]) => (
                            <p key={field} className="text-[10px] font-mono text-muted-foreground">
                              <span className="text-foreground">{field}:</span>{" "}
                              <span className="text-sev-critical line-through">
                                {String(diff.old ?? "—")}
                              </span>{" "}
                              <span className="text-sev-low">
                                {String(diff.new ?? "—")}
                              </span>
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>

          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
