import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { ThemeProvider } from "@/contexts/ThemeContext";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { App } from "./App";

const Dashboard    = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const TargetDetail = lazy(() => import("./pages/TargetDetail").then((m) => ({ default: m.TargetDetail })));
const PipelineEditor = lazy(() => import("./pages/PipelineEditor").then((m) => ({ default: m.PipelineEditor })));
const Settings     = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const NotFound     = lazy(() => import("./pages/NotFound").then((m) => ({ default: m.NotFound })));

import "./index.css";

function installLocalhostApiFetchGuard(): void {
  // Defensive runtime guard: if stale/cached code emits absolute localhost API
  // URLs, rewrite them to same-origin relative paths so CSP connect-src 'self'
  // continues to work.
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;

  const originalFetch = window.fetch.bind(window);

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" && input.startsWith("https://localhost/api/")) {
      const sameOriginPath = input.replace(/^https:\/\/localhost/, "");
      return originalFetch(sameOriginPath, init);
    }

    if (input instanceof URL && input.protocol === "https:" && input.hostname === "localhost" && input.pathname.startsWith("/api/")) {
      return originalFetch(input.pathname + input.search + input.hash, init);
    }

    if (input instanceof Request) {
      const url = input.url;
      if (url.startsWith("https://localhost/api/")) {
        const sameOriginPath = url.replace(/^https:\/\/localhost/, "");
        return originalFetch(new Request(sameOriginPath, input), init);
      }
    }

    return originalFetch(input, init);
  }) as typeof window.fetch;
}

installLocalhostApiFetchGuard();

const PageSpinner = (
  <div className="flex items-center justify-center h-screen">
    <Loader2 className="w-6 h-6 animate-spin text-primary" />
  </div>
);

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true,                      element: <Suspense fallback={PageSpinner}><Dashboard /></Suspense> },
      { path: "target/:id",               element: <Suspense fallback={PageSpinner}><TargetDetail /></Suspense> },
      { path: "target/:id/pipeline/edit", element: <Suspense fallback={PageSpinner}><PipelineEditor /></Suspense> },
      { path: "settings",                 element: <Suspense fallback={PageSpinner}><Settings /></Suspense> },
      { path: "*",                         element: <Suspense fallback={PageSpinner}><NotFound /></Suspense> },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <NotificationsProvider>
        <ToastProvider>
          <ErrorBoundary label="App">
            <RouterProvider router={router} />
          </ErrorBoundary>
        </ToastProvider>
      </NotificationsProvider>
    </ThemeProvider>
  </StrictMode>,
);
