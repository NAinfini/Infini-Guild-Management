import { useEffect, useRef, useState } from "react";

export interface NumberTickerProps {
  value: number;
  className?: string;
  duration?: number;
  decimals?: number;
  suffix?: string;
}

export function NumberTicker({ value, className, duration = 800, decimals = 0, suffix }: NumberTickerProps) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef<number | null>(null);
  const frameRef = useRef(0);

  useEffect(() => {
    const from = display;
    const diff = value - from;
    if (diff === 0) return;

    startRef.current = null;
    const step = (timestamp: number) => {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const raw = from + diff * eased;
      setDisplay(decimals > 0 ? raw : Math.round(raw));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      }
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
     
  }, [value, duration]);

  return (
    <span className={["portal-kpi-value", className].filter(Boolean).join(" ")}>
      {decimals > 0 ? display.toFixed(decimals) : display.toLocaleString()}
      {suffix}
    </span>
  );
}
