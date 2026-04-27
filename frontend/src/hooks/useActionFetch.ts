import { useCallback, useState } from "react";
import { useToast } from "@/contexts/ToastContext";

interface ActionFetchOptions extends RequestInit {
  successMessage?: string;
  errorPrefix?: string;
}

interface ErrorResponse {
  detail?: string;
  error?: string;
}

export function useActionFetch() {
  const { addToast } = useToast();
  const [pending, setPending] = useState(false);

  const actionFetch = useCallback(
    async (url: string, options: ActionFetchOptions = {}): Promise<Response | null> => {
      const { successMessage, errorPrefix, ...fetchOptions } = options;
      setPending(true);
      try {
        const res = await fetch(url, fetchOptions);
        if (res.ok) {
          if (successMessage) addToast(successMessage, "success");
          return res;
        }
        let detail = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as ErrorResponse;
          detail = body.detail ?? body.error ?? detail;
        } catch {
          // ignore JSON parse failure — use status code string
        }
        const msg = errorPrefix ? `${errorPrefix}: ${detail}` : detail;
        addToast(msg, "error");
        return null;
      } catch {
        const msg = errorPrefix
          ? `${errorPrefix}: Network error`
          : "Network error — check your connection";
        addToast(msg, "error");
        return null;
      } finally {
        setPending(false);
      }
    },
    [addToast],
  );

  return { actionFetch, pending };
}
