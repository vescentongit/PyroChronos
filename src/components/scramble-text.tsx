"use client";

import { useEffect, useState } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&/<>";

export function ScrambleText({
  text,
  delay = 0,
  duration = 900,
}: {
  text: string;
  delay?: number;
  duration?: number;
}) {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(text);
      return;
    }
    let frame = 0;
    let begin = 0;
    const timer = window.setTimeout(() => {
      begin = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - begin) / duration);
        const settled = Math.floor(progress * text.length);
        setShown(
          text
            .split("")
            .map((char, index) =>
              char === " " || index < settled
                ? char
                : GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
            )
            .join(""),
        );
        if (progress < 1) frame = requestAnimationFrame(tick);
        else setShown(text);
      };
      frame = requestAnimationFrame(tick);
    }, delay);
    setShown(
      text
        .split("")
        .map((char) =>
          char === " " ? char : GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
        )
        .join(""),
    );
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [text, delay, duration]);
  return (
    <span aria-label={text}>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}
