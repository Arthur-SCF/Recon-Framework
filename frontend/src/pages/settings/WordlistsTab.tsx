import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useActionFetch } from "@/hooks/useActionFetch";

interface WordlistEntry {
  name:       string;
  type:       "bundled" | "custom";
  size_bytes: number;
  lines:      number;
}

function fmtSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000)     return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function WordlistsTab() {
  const [wordlists,     setWordlists]     = useState<WordlistEntry[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [updating,      setUpdating]      = useState(false);
  const [updateMsg,     setUpdateMsg]     = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting,      setDeleting]      = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { actionFetch, pending: uploading } = useActionFetch();

  const loadWordlists = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/wordlists");
      if (res.ok) setWordlists(await res.json() as WordlistEntry[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadWordlists(); }, [loadWordlists]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const res = await actionFetch("/api/v1/wordlists/upload", {
      method: "POST",
      body: form,
      errorPrefix: "Upload wordlist",
      successMessage: "Wordlist uploaded",
    });
    if (!res) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
    await loadWordlists();
  }

  async function confirmDeleteWordlist() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await actionFetch(`/api/v1/wordlists/custom/${encodeURIComponent(pendingDelete)}`, {
        method: "DELETE",
        errorPrefix: "Delete wordlist",
        successMessage: "Wordlist deleted",
      });
      if (!res) return;
      setWordlists((prev) => prev.filter((w) => w.name !== pendingDelete));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  async function updateResolvers() {
    setUpdating(true);
    setUpdateMsg(null);
    const res = await actionFetch("/api/v1/wordlists/resolvers/update", {
      method: "POST",
      errorPrefix: "Update resolvers",
    });
    if (res) {
      const data = await res.json() as { resolvers_count: number; trusted_count: number };
      setUpdateMsg(`Updated: ${data.resolvers_count} resolvers, ${data.trusted_count} trusted`);
    } else {
      setUpdateMsg("Failed to update resolvers");
    }
    setUpdating(false);
  }

  return (
    <div className="flex flex-col gap-6 py-4 max-w-2xl">
      {/* Actions row */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Upload Wordlist
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt"
          className="hidden"
          onChange={(e) => void handleUpload(e)}
        />

        <button
          onClick={() => void updateResolvers()}
          disabled={updating}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
        >
          {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Update Resolvers
        </button>

        {updateMsg && <span className="text-xs text-muted-foreground">{updateMsg}</span>}
      </div>

      {/* Wordlist table */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : wordlists.length === 0 ? (
        <p className="text-sm text-muted-foreground">No wordlists found.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-3 py-2 font-medium text-muted-foreground">Name</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Type</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Lines</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Size</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {wordlists.map((w, i) => (
                <tr
                  key={w.name}
                  className={cn(
                    "border-b border-border last:border-0",
                    i % 2 === 0 ? "bg-background" : "bg-muted/10",
                  )}
                >
                  <td className="px-3 py-2 font-mono text-foreground">{w.name}</td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium",
                      w.type === "bundled"
                        ? "bg-muted text-muted-foreground"
                        : "bg-primary/15 text-primary",
                    )}>
                      {w.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{w.lines.toLocaleString()}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtSize(w.size_bytes)}</td>
                  <td className="px-3 py-2">
                    {w.type === "custom" && (
                      <button
                        onClick={() => setPendingDelete(w.name)}
                        className="rounded p-1 text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DeleteConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        itemName={pendingDelete ?? ""}
        itemType="wordlist"
        onConfirm={confirmDeleteWordlist}
        loading={deleting}
      />
    </div>
  );
}
