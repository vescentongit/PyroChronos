"use client";

import { useEffect, useRef, useState } from "react";
import { geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import type { FeatureCollection } from "geojson";
import {
  Globe2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Flame,
} from "lucide-react";
import type { Language, RegionId } from "@/lib/regions";
import { candidates } from "@/lib/data";
import { constrainZoom, isFrontFacing } from "@/lib/globe-geometry";

export const globeHotspots = Object.entries(candidates).flatMap(
  ([region, points]) =>
    points.map((point) => ({ ...point, region: region as RegionId })),
);
export type GlobeHotspot = (typeof globeHotspots)[number];

interface RotatingEarthProps {
  width?: number;
  height?: number;
  className?: string;
  language?: Language;
  onHotspotChange?: (point: GlobeHotspot | null) => void;
  onHotspotSelect?: (point: GlobeHotspot) => void;
}
type Controls = {
  zoom: (factor: number) => void;
  reset: () => void;
  pause: () => void;
  hotspots: () => void;
};

export default function RotatingEarth({
  width = 820,
  height = 650,
  className = "",
  language = "id",
  onHotspotChange,
  onHotspotSelect,
}: RotatingEarthProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const controls = useRef<Controls | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const t = (id: string, en: string) => (language === "id" ? id : en);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const context = canvas.getContext("2d");
    if (!context) {
      setError(true);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const projection = geoOrthographic().clipAngle(90);
    const path = geoPath(projection, context);
    const graticule = geoGraticule10();
    let land: FeatureCollection | null = null;
    let dots: [number, number][] = [];
    let size = { width: 0, height: 0, radius: 0 };
    let rotation: [number, number, number] = [-119, 4, 0];
    let zoom = 1;
    let isPaused = motion.matches;
    let show = false;
    let hover = false;
    let focused = false;
    let inView = true;
    let dragging: {
      id: number;
      x: number;
      y: number;
      rotation: [number, number, number];
      moved: boolean;
    } | null = null;
    let active: GlobeHotspot | null = null;
    let projected: { point: GlobeHotspot; x: number; y: number }[] = [];
    let frame: number | null = null;
    let previousTime = 0;
    setPaused(isPaused);

    function render() {
      if (!context || !canvas || !size.width) return;
      const { width: w, height: h, radius } = size;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, w, h);
      projection
        .scale(radius * zoom)
        .translate([w / 2, h / 2])
        .rotate(rotation);
      const center = projection.invert([w / 2, h / 2]) || [119, -4];
      context.beginPath();
      path({ type: "Sphere" });
      context.fillStyle = "#0e0e0e";
      context.fill();
      context.strokeStyle = "rgba(255,255,255,0.42)";
      context.lineWidth = 1;
      context.stroke();
      context.beginPath();
      path(graticule);
      context.strokeStyle = "rgba(72,118,194,0.4)";
      context.lineWidth = 0.65;
      context.stroke();
      if (land) {
        context.beginPath();
        path(land);
        context.strokeStyle = "rgba(255,255,255,0.36)";
        context.lineWidth = 0.65;
        context.stroke();
        context.fillStyle = "rgba(255,255,255,0.68)";
        context.beginPath();
        for (const dot of dots) {
          if (!isFrontFacing(dot, center)) continue;
          const point = projection(dot);
          if (!point) continue;
          context.moveTo(point[0] + 1.05, point[1]);
          context.arc(point[0], point[1], 1.05, 0, Math.PI * 2);
        }
        context.fill();
      }
      projected = [];
      if (show || hover || focused) {
        for (const point of globeHotspots) {
          const coordinates: [number, number] = [point.lng, point.lat];
          if (!isFrontFacing(coordinates, center)) continue;
          const xy = projection(coordinates);
          if (!xy) continue;
          projected.push({ point, x: xy[0], y: xy[1] });
          context.beginPath();
          context.arc(
            xy[0],
            xy[1],
            active?.id === point.id ? 5 : 3.2,
            0,
            Math.PI * 2,
          );
          context.fillStyle = point.hours <= 24 ? "#fc3c23" : "#ba1e68";
          context.fill();
          if (active?.id === point.id) {
            context.beginPath();
            context.arc(xy[0], xy[1], 11, 0, Math.PI * 2);
            context.strokeStyle = "#ffffff";
            context.lineWidth = 1;
            context.stroke();
          }
        }
        // Named study regions stay legible when points cluster at global scale.
        for (const [name, coordinates] of [
          ["KALIMANTAN", [113.8, 2.5]],
          ["PAPUA", [143, -11.5]],
        ] as [string, [number, number]][]) {
          if (!isFrontFacing(coordinates, center)) continue;
          const xy = projection(coordinates);
          if (xy) {
            context.font = `600 10px ${getComputedStyle(canvas).fontFamily}`;
            context.fillStyle = "#ffffff";
            context.fillText(name, xy[0] - name.length * 3, xy[1]);
          }
        }
      }
    }
    function schedule() {
      if (
        frame === null &&
        !document.hidden &&
        inView &&
        !controller.signal.aborted
      )
        frame = requestAnimationFrame(step);
    }
    function step(time: number) {
      frame = null;
      const elapsed = previousTime ? Math.min(time - previousTime, 60) : 0;
      previousTime = time;
      if (!isPaused && !hover && !focused && !dragging)
        rotation[0] += elapsed * 0.004;
      render();
      if (!isPaused && !hover && !focused && !dragging) schedule();
    }
    function resize() {
      if (!host || !canvas) return;
      const w = Math.min(width, host.clientWidth);
      const h = Math.min(height, w * 0.84);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = { width: w, height: h, radius: Math.min(w * 0.43, h * 0.46) };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      render();
    }
    function setActive(next: GlobeHotspot | null) {
      if (active?.id === next?.id) return;
      active = next;
      onHotspotChange?.(next);
    }
    function pointerMove(event: PointerEvent) {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left,
        y = event.clientY - rect.top;
      hover =
        Math.hypot(x - size.width / 2, y - size.height / 2) <
        size.radius * zoom;
      if (dragging && dragging.id === event.pointerId) {
        const dx = event.clientX - dragging.x,
          dy = event.clientY - dragging.y;
        dragging.moved ||= Math.hypot(dx, dy) > 5;
        rotation = [
          dragging.rotation[0] + dx * 0.25,
          Math.max(-70, Math.min(70, dragging.rotation[1] - dy * 0.25)),
          0,
        ];
      } else {
        const nearest = projected.reduce<{
          point: GlobeHotspot;
          distance: number;
        } | null>((best, item) => {
          const distance = Math.hypot(x - item.x, y - item.y);
          return distance < 22 && (!best || distance < best.distance)
            ? { point: item.point, distance }
            : best;
        }, null);
        setActive(nearest?.point || null);
      }
      render();
      if (!hover) schedule();
    }
    function pointerDown(event: PointerEvent) {
      if (!canvas || (event.pointerType === "mouse" && event.button !== 0))
        return;
      canvas.setPointerCapture(event.pointerId);
      dragging = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        rotation: [...rotation],
        moved: false,
      };
      hover = true;
      render();
    }
    function pointerUp(event: PointerEvent) {
      if (dragging?.id !== event.pointerId) return;
      const click = !dragging.moved;
      dragging = null;
      if (canvas?.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
      if (click && canvas) {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left,
          y = event.clientY - rect.top;
        const hit = projected.reduce<{
          point: GlobeHotspot;
          distance: number;
        } | null>((best, item) => {
          const distance = Math.hypot(x - item.x, y - item.y);
          return distance < 22 && (!best || distance < best.distance)
            ? { point: item.point, distance }
            : best;
        }, null);
        setActive(hit?.point || null);
        if (hit) onHotspotSelect?.(hit.point);
      }
      render();
      schedule();
    }
    function pointerCancel() {
      dragging = null;
      hover = false;
      setActive(null);
      render();
      schedule();
    }
    function leave() {
      if (!dragging) {
        hover = false;
        setActive(null);
        render();
        schedule();
      }
    }
    function wheel(event: WheelEvent) {
      event.preventDefault();
      zoom = constrainZoom(zoom * (event.deltaY > 0 ? 0.94 : 1.06));
      render();
    }
    function focus() {
      focused = true;
      render();
    }
    function blur() {
      focused = false;
      setActive(null);
      render();
      schedule();
    }
    function keyboard(event: KeyboardEvent) {
      const actions: Record<string, () => void> = {
        ArrowLeft: () => (rotation[0] -= 8),
        ArrowRight: () => (rotation[0] += 8),
        ArrowUp: () => (rotation[1] = Math.min(70, rotation[1] + 8)),
        ArrowDown: () => (rotation[1] = Math.max(-70, rotation[1] - 8)),
        "+": () => (zoom = constrainZoom(zoom * 1.1)),
        "-": () => (zoom = constrainZoom(zoom / 1.1)),
        Home: () => {
          rotation = [-119, 4, 0];
          zoom = 1;
        },
      };
      if (actions[event.key]) {
        event.preventDefault();
        actions[event.key]();
        render();
      }
    }
    function visibility() {
      previousTime = 0;
      schedule();
    }
    function motionChange() {
      if (motion.matches) {
        isPaused = true;
        setPaused(true);
      }
      render();
      schedule();
    }
    controls.current = {
      zoom(factor) {
        zoom = constrainZoom(zoom * factor);
        render();
      },
      reset() {
        rotation = [-119, 4, 0];
        zoom = 1;
        setActive(null);
        render();
      },
      pause() {
        isPaused = !isPaused;
        setPaused(isPaused);
        previousTime = 0;
        schedule();
      },
      hotspots() {
        show = !show;
        setPinned(show);
        if (show) {
          rotation = [-119, 4, 0];
          setActive(globeHotspots[0]);
        } else setActive(null);
        render();
      },
    };
    const listeners = {
      pointerdown: pointerDown,
      pointermove: pointerMove,
      pointerup: pointerUp,
      pointercancel: pointerCancel,
      pointerleave: leave,
      focus,
      blur,
      keydown: keyboard,
    };
    for (const [name, listener] of Object.entries(listeners))
      canvas.addEventListener(name, listener as EventListener, {
        signal: controller.signal,
      });
    canvas.addEventListener("wheel", wheel, {
      passive: false,
      signal: controller.signal,
    });
    document.addEventListener("visibilitychange", visibility, {
      signal: controller.signal,
    });
    motion.addEventListener("change", motionChange);
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const intersection = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      previousTime = 0;
      if (inView) schedule();
    });
    intersection.observe(host);
    resize();
    schedule();
    Promise.all([
      fetch("/geo/ne_110m_land.json", { signal: controller.signal }),
      fetch("/geo/land-dots.json", { signal: controller.signal }),
    ])
      .then(async ([world, points]) => {
        if (!world.ok || !points.ok) throw new Error("Geography unavailable");
        const geometry = await world.json();
        const data = await points.json();
        if (
          geometry.type !== "FeatureCollection" ||
          !Array.isArray(geometry.features) ||
          !Array.isArray(data.points)
        )
          throw new Error("Invalid geography");
        if (controller.signal.aborted) return;
        land = geometry;
        dots = data.points;
        setLoading(false);
        render();
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setError(true);
        }
      });
    return () => {
      controller.abort();
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      motion.removeEventListener("change", motionChange);
      controls.current = null;
    };
  }, [width, height, onHotspotChange, onHotspotSelect]);

  return (
    <div ref={hostRef} className={`earth-visualization ${className}`}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label={t(
          "Globe interaktif. Tombol panah memutar; plus/minus untuk zoom. Hotspot ilustratif terlihat saat fokus. Pilih wilayah dari tautan di bawah globe.",
          "Interactive globe. Arrow keys rotate; plus/minus zoom. Illustrative hotspots appear on focus. Choose a region using the links below the globe.",
        )}
      />
      {loading && (
        <div className="earth-load" role="status">
          <Globe2 size={20} />
          {t("Menyiapkan globe…", "Preparing the globe…")}
        </div>
      )}
      {error && (
        <div className="earth-load" role="status">
          {t(
            "Peta daratan belum dapat dimuat. Tautan Simulation tetap tersedia.",
            "Land geometry could not load. Simulation links remain available.",
          )}
        </div>
      )}
      <div
        className="earth-controls"
        aria-label={t("Kontrol globe", "Globe controls")}
      >
        <button
          type="button"
          onClick={() => controls.current?.pause()}
          aria-label={
            paused
              ? t("Putar otomatis", "Play rotation")
              : t("Jeda rotasi", "Pause rotation")
          }
        >
          {paused ? <Play size={15} /> : <Pause size={15} />}
        </button>
        <button
          type="button"
          onClick={() => controls.current?.zoom(1 / 1.15)}
          aria-label={t("Perkecil", "Zoom out")}
        >
          <Minus size={16} />
        </button>
        <button
          type="button"
          onClick={() => controls.current?.zoom(1.15)}
          aria-label={t("Perbesar", "Zoom in")}
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          onClick={() => controls.current?.reset()}
          aria-label={t("Kembali ke Indonesia", "Reset to Indonesia")}
        >
          <RotateCcw size={15} />
        </button>
        <button
          type="button"
          className="hotspot-toggle"
          aria-pressed={pinned}
          onClick={() => controls.current?.hotspots()}
        >
          <Flame size={15} />
          {t("Hotspot demo", "Demo hotspots")}
        </button>
      </div>
    </div>
  );
}
