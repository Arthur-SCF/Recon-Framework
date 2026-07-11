import { motion } from "framer-motion";
import { CheckCircle2, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

interface WizardStepDomainProps {
  domain: string;
  onChange: (domain: string) => void;
}

export function WizardStepDomain({ domain, onChange }: WizardStepDomainProps) {
  const trimmed = domain.trim();
  const isValid = trimmed.length > 0 && DOMAIN_REGEX.test(trimmed);

  return (
    <motion.div
      className="flex flex-col items-center gap-6 py-4"
      initial={{ opacity: 0, x: 200 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -200 }}
      transition={{ duration: 0.2 }}
    >
      <div className="text-center">
        <Globe className="mx-auto h-8 w-8 text-primary/60" />
        <h3 className="mt-3 text-base font-semibold text-foreground">
          Enter target domain
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          The root domain to scan for subdomains and vulnerabilities
        </p>
      </div>

      <div className="relative w-full max-w-sm">
        <input
          autoFocus
          type="text"
          value={domain}
          onChange={(e) => onChange(e.target.value)}
          placeholder="example.com"
          className={cn(
            "w-full rounded-md border bg-input px-4 py-3 text-center text-sm font-mono text-foreground placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-2",
            isValid
              ? "border-sev-low/50 focus:ring-sev-low/30"
              : trimmed.length > 0
                ? "border-sev-critical/50 focus:ring-sev-critical/30"
                : "border-border focus:ring-primary/30",
          )}
        />
        {isValid && (
          <motion.div
            className="absolute right-3 top-1/2 -translate-y-1/2"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
          >
            <CheckCircle2 className="h-4 w-4 text-sev-low" />
          </motion.div>
        )}
      </div>

      {trimmed.length > 0 && !isValid && (
        <p className="text-xs text-sev-critical">
          Enter a valid domain (e.g., example.com)
        </p>
      )}
    </motion.div>
  );
}
