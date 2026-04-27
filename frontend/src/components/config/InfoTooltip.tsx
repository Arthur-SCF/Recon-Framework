import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";

interface Props {
  text: string;
}

export function InfoTooltip({ text }: Props) {
  if (!text) return null;
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <span className="inline-flex cursor-default text-muted-foreground/50 hover:text-muted-foreground transition-colors">
            <Info className="h-3.5 w-3.5" />
          </span>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className="max-w-xs rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md z-50"
            sideOffset={6}
          >
            {text}
            <TooltipPrimitive.Arrow className="fill-border" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
