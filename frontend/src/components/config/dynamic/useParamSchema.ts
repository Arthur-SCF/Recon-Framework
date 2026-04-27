import { useEffect, useState } from "react";

export type ParamType =
  | "int" | "float" | "bool" | "string" | "enum"
  | "csv" | "kv" | "textarea" | "secret";

export type BucketType = "basic" | "advanced" | "danger";

export interface ParamDescriptor {
  key:       string;
  label:     string;
  type:      ParamType;
  default?:  unknown;
  min?:      number;
  max?:      number;
  step?:     number;
  unit?:     string;
  options?:  string[];
  bucket?:   BucketType;
  group?:    string;
  tooltip?:  string;
  cli_flag?: string;
}

// Global cache — schema doesn't change at runtime
const _cache = new Map<string, ParamDescriptor[]>();

export function useParamSchema(stepId: string): {
  schema: ParamDescriptor[];
  loading: boolean;
} {
  const [schema,  setSchema]  = useState<ParamDescriptor[]>(_cache.get(stepId) ?? []);
  const [loading, setLoading] = useState(!_cache.has(stepId));

  useEffect(() => {
    if (_cache.has(stepId)) {
      setSchema(_cache.get(stepId)!);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void fetch(`/api/v1/pipeline/steps/${encodeURIComponent(stepId)}/schema`)
      .then(r => r.ok ? (r.json() as Promise<ParamDescriptor[]>) : [])
      .then(data => {
        if (cancelled) return;
        _cache.set(stepId, data);
        setSchema(data);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [stepId]);

  return { schema, loading };
}
