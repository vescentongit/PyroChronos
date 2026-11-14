"use client";

import { useEffect, useRef } from "react";

const GLOW =
  ".fx-card, .fire-kpi, .fire-focus, .landing-stat, .landing-feature, .landing-hotspot, .landing-sensor, .metrics article, .mission, .nav-item, .outline, .primary, .landing-primary, .landing-ghost, .calendar-cell, .earth-controls button, .map-wrap, .context-panel, .report-row";
const RIPPLE = ".outline, .primary, .landing-primary, .landing-ghost, .earth-controls button";

export function FxLayer() {
  const aura = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    let target = { x: -400, y: -400 };
    let current = { ...target };
    let frame = 0;
    let hot: HTMLElement | null = null;
    const loop = () => {
      current.x += (target.x - current.x) * 0.14;
      current.y += (target.y - current.y) * 0.14;
      if (aura.current)
        aura.current.style.transform = `translate(${current.x}px, ${current.y}px)`;
      frame = requestAnimationFrame(loop);
    };
    const move = (event: PointerEvent) => {
      target = { x: event.clientX, y: event.clientY };
      if (current.x < 0) current = { ...target };
      aura.current?.setAttribute("data-on", "true");
      aura.current?.setAttribute(
        "data-over",
        (event.target as Element | null)?.closest?.("a, button, select, summary")
          ? "true"
          : "false",
      );
      const element = (event.target as Element | null)?.closest?.(GLOW);
      if (hot && hot !== element) hot.removeAttribute("data-hot");
      if (element instanceof HTMLElement) {
        const box = element.getBoundingClientRect();
        element.style.setProperty("--mx", `${event.clientX - box.left}px`);
        element.style.setProperty("--my", `${event.clientY - box.top}px`);
        element.setAttribute("data-hot", "true");
        hot = element;
      } else hot = null;
    };
    const leave = () => {
      aura.current?.setAttribute("data-on", "false");
      hot?.removeAttribute("data-hot");
      hot = null;
    };
    const press = (event: PointerEvent) => {
      if (calm.matches) return;
      const element = (event.target as Element | null)?.closest?.(RIPPLE);
      if (!(element instanceof HTMLElement)) return;
      const box = element.getBoundingClientRect();
      const size = Math.max(box.width, box.height) * 2.2;
      const dot = document.createElement("span");
      dot.className = "fx-ripple-dot";
      dot.style.cssText = `left:${event.clientX - box.left}px;top:${event.clientY - box.top}px;width:${size}px;height:${size}px`;
      element.appendChild(dot);
      dot.addEventListener("animationend", () => dot.remove(), { once: true });
    };
    document.addEventListener("pointerdown", press, true);
    if (fine && !calm.matches) {
      document.addEventListener("pointermove", move, { passive: true });
      document.documentElement.addEventListener("pointerleave", leave);
      frame = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, []);
  return <div ref={aura} className="fx-aura" aria-hidden="true" data-on="false" />;
}
