import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";

export function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <AlertTriangle className="w-12 h-12 text-muted-foreground" />
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link to="/" className="text-sm text-primary hover:underline">Back to Dashboard</Link>
    </div>
  );
}
