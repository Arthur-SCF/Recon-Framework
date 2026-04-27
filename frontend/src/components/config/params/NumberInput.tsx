import { useState, useEffect } from "react";

interface Props {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}

/**
 * Number input with co-located local state so the displayed value updates
 * instantly on every click — no waiting for the parent re-render cycle.
 *
 * Without this, React's controlled-input behaviour resets the DOM value back
 * to the stale React value between rapid spinner clicks, making every click
 * increment from the same base and feel unresponsive.
 */
export function NumberInput({ value, onChange, min, max, step, className }: Props) {
  const [local, setLocal] = useState(value);

  // Sync when the saved value arrives from outside (API refresh, prop reset)
  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={local}
      onChange={(e) => {
        const v = Number(e.target.value);
        setLocal(v);
        onChange(v);
      }}
      className={className}
    />
  );
}
