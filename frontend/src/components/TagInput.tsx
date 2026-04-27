import { useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  max?: number;
  placeholder?: string;
  className?: string;
}

const TAG_RE = /^[a-z0-9][a-z0-9\-_]*$/;
const MAX_DEFAULT = 10;

function normalise(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, "-");
}

export function TagInput({
  tags,
  onChange,
  max = MAX_DEFAULT,
  placeholder = "Add tag…",
  className,
}: TagInputProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addTag(raw: string) {
    const t = normalise(raw);
    if (!t || !TAG_RE.test(t) || t.length > 32) return;
    if (tags.includes(t) || tags.length >= max) return;
    onChange([...tags, t]);
    setInput("");
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-[34px] flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 cursor-text",
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground"
        >
          #{tag}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      {tags.length < max && (
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (input) addTag(input); }}
          placeholder={tags.length === 0 ? placeholder : ""}
          className="min-w-[80px] flex-1 border-none bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
        />
      )}
    </div>
  );
}
