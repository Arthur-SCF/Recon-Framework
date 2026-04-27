import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { num: 1, label: "Domain" },
  { num: 2, label: "Template" },
  { num: 3, label: "Options" },
  { num: 4, label: "Review" },
];

interface WizardProgressProps {
  currentStep: number;
}

export function WizardProgress({ currentStep }: WizardProgressProps) {
  return (
    <div className="flex items-center justify-center gap-0 px-4">
      {STEPS.map(({ num, label }, i) => {
        const isActive = num === currentStep;
        const isDone = num < currentStep;

        return (
          <div key={num} className="flex items-center">
            {/* Step circle */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-all duration-300",
                  isDone
                    ? "bg-primary text-primary-foreground"
                    : isActive
                      ? "bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2 ring-offset-card"
                      : "bg-muted/50 text-muted-foreground border border-border",
                )}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : num}
              </div>
              <span
                className={cn(
                  "mt-1.5 text-[10px] font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : isDone
                      ? "text-foreground"
                      : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </div>

            {/* Connector line */}
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "mx-3 mb-5 h-px w-12 transition-colors duration-300",
                  num < currentStep ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
