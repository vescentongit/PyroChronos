"use client";

import { useEffect, useRef, useState } from "react";

export function CountUp({
  value,
  locale,
  duration = 900,
  maximumFractionDigits = 0,
}: {
  value: number | null;
  locale: string;
  duration?: number;
  maximumFractionDigits?: number;
}) {
  const [shown, setShown] = useState<number | null>(value);
  const previous = useRef<number | null>(null);
  useEffect(() => {
    if (value === null) {
      setShown(null);
      previous.current = null;
      return;
    }
    const from = previous.current ?? 0;
    previous.current = value;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || from === value) {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setShown(from + (value - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  const format = (number: number) =>
    number.toLocaleString(locale, { maximumFractionDigits });
  return (
    <span className="count-up" aria-label={value === null ? undefined : format(value)}>
      <span aria-hidden={value === null ? undefined : true}>
        {shown === null ? "—" : format(shown)}
      </span>
    </span>
  );
}
