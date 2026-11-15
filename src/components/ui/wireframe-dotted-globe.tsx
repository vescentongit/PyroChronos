"use client";

import { useEffect, useRef, useState } from "react";
import { geoGraticule10, geoInterpolate, geoOrthographic, geoPath } from "d3-geo";
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
import type { Language } from "@/lib/regions";
import { constrainZoom, isFrontFacing, type GlobeHotspot, type GlobeLocation } from "@/lib/globe-geometry";

interface RotatingEarthProps {
  width?: number;
  height?: number;
  className?: string;
  language?: Language;
  hotspots: GlobeHotspot[];
  onHotspotChange?: (point: GlobeHotspot | null) => void;
  onLocationSelect?: (point: GlobeLocation, hotspot?: GlobeHotspot) => void;
  onFlightStart?: (point: GlobeLocation) => void;
  onRelease?: () => void;
  controlRef?: React.MutableRefObject<GlobeHandle | null>;
}
export type GlobeHandle = { release: () => void };
type Controls = {
  zoom: (factor: number) => void;
  reset: () => void;
  pause: () => void;
  hotspots: () => void;
  redraw: () => void;
};

export default function RotatingEarth({
  width = 820,
  height = 650,
  className = "",
  language = "id",
  hotspots,
  onHotspotChange,
  onLocationSelect,
  onFlightStart,
  onRelease,
  controlRef,
}: RotatingEarthProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const controls = useRef<Controls | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [opening, setOpening] = useState(false);
  const pointsRef = useRef(hotspots);
  useEffect(() => {
    pointsRef.current = hotspots;
    controls.current?.redraw();
  }, [hotspots]);
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
    let show = true;
    let navigating = false;
    let navigationDone = false;
    let navigationTimer: number | null = null;
    let flight: { target: GlobeLocation; start: number; rotation: [number, number, number]; zoom: number } | null = null;
    let held: GlobeLocation | null = null;
    let pending: GlobeHotspot | undefined;
    let home: { rotation: [number, number, number]; zoom: number } | null = null;
    let ret: { from: [number, number, number]; fromZoom: number; start: number } | null = null;
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
      const now = performance.now();
      const calm = motion.matches;
      const cx = w / 2;
      const cy = h / 2;
      const scaled = radius * zoom;
      projection.scale(scaled).translate([cx, cy]).rotate(rotation);
      const center = projection.invert([cx, cy]) || [119, -4];
      const family = getComputedStyle(canvas).fontFamily;
      const lightX = cx - scaled * 0.5;
      const lightY = cy - scaled * 0.55;
      const orbitFade = Math.max(0, Math.min(1, (2.4 - zoom) / 1.2));

      const halo = context.createRadialGradient(cx, cy, scaled * 0.94, cx, cy, scaled * 1.34);
      halo.addColorStop(0, "rgba(148,226,255,0.5)");
      halo.addColorStop(0.2, "rgba(96,165,250,0.2)");
      halo.addColorStop(1, "rgba(96,165,250,0)");
      context.fillStyle = halo;
      context.beginPath();
      context.arc(cx, cy, scaled * 1.34, 0, Math.PI * 2);
      context.fill();

      const orbits = [
        { rx: 1.3, ry: 0.3, tilt: -0.42, speed: 0.00021, phase: 0.6, hue: "#ffffff" },
        { rx: 1.42, ry: 0.4, tilt: 0.32, speed: -0.00015, phase: 2.4, hue: "#5eead4" },
        { rx: 1.2, ry: 0.22, tilt: 1.05, speed: 0.00028, phase: 4.1, hue: "#ff7a1a" },
      ];
      if (orbitFade > 0) {
        context.save();
        context.translate(cx, cy);
        for (const orbit of orbits) {
          context.save();
          context.rotate(orbit.tilt);
          context.beginPath();
          context.ellipse(0, 0, scaled * orbit.rx, scaled * orbit.ry, 0, 0, Math.PI * 2);
          context.strokeStyle = "rgba(255,255,255,0.2)";
          context.globalAlpha = orbitFade;
          context.lineWidth = 0.8;
          context.setLineDash([2, 6]);
          context.stroke();
          context.setLineDash([]);
          context.restore();
        }
        context.restore();
        context.globalAlpha = 1;
      }

      const body = context.createRadialGradient(lightX, lightY, scaled * 0.05, cx, cy, scaled * 1.02);
      body.addColorStop(0, "#1b2a5c");
      body.addColorStop(0.45, "#0d1633");
      body.addColorStop(0.8, "#070b1d");
      body.addColorStop(1, "#04060f");
      context.beginPath();
      path({ type: "Sphere" });
      context.fillStyle = body;
      context.fill();

      context.save();
      context.beginPath();
      path({ type: "Sphere" });
      context.clip();
      context.beginPath();
      path(graticule);
      context.strokeStyle = "rgba(160,180,230,0.12)";
      context.lineWidth = 0.6;
      context.stroke();
      if (land) {
        context.beginPath();
        path(land);
        context.strokeStyle = "rgba(210,225,255,0.3)";
        context.lineWidth = 0.7;
        context.stroke();
        const palette = ["150,215,240", "170,220,245", "190,225,250", "205,230,255", "220,235,255", "235,242,255"];
        const buckets: Path2D[] = [];
        for (let i = 0; i < palette.length * 3; i++) buckets.push(new Path2D());
        const dotSize = Math.max(0.9, scaled / 420);
        for (const dot of dots) {
          if (!isFrontFacing(dot, center)) continue;
          const point = projection(dot);
          if (!point) continue;
          const across = (point[0] - (cx - scaled)) / (2 * scaled);
          const color = Math.max(0, Math.min(palette.length - 1, Math.floor(across * palette.length)));
          const lit = 1 - Math.hypot(point[0] - lightX, point[1] - lightY) / (1.95 * scaled);
          const level = lit > 0.62 ? 2 : lit > 0.34 ? 1 : 0;
          const bucket = buckets[color * 3 + level];
          bucket.moveTo(point[0] + dotSize, point[1]);
          bucket.arc(point[0], point[1], dotSize, 0, Math.PI * 2);
        }
        for (let color = 0; color < palette.length; color++)
          for (let level = 0; level < 3; level++) {
            context.fillStyle = `rgba(${palette[color]},${[0.4, 0.72, 1][level]})`;
            context.fill(buckets[color * 3 + level]);
          }
      }
      const night = context.createRadialGradient(cx + scaled * 0.62, cy + scaled * 0.5, scaled * 0.1, cx + scaled * 0.62, cy + scaled * 0.5, scaled * 1.35);
      night.addColorStop(0, "rgba(2,3,18,0.6)");
      night.addColorStop(0.55, "rgba(2,3,18,0.3)");
      night.addColorStop(1, "rgba(2,3,18,0)");
      context.fillStyle = night;
      context.fillRect(0, 0, w, h);
      const inner = context.createRadialGradient(cx, cy, scaled * 0.84, cx, cy, scaled);
      inner.addColorStop(0, "rgba(125,211,252,0)");
      inner.addColorStop(1, "rgba(148,226,255,0.22)");
      context.fillStyle = inner;
      context.fillRect(0, 0, w, h);
      context.restore();

      const rim = context.createLinearGradient(cx - scaled, cy - scaled, cx + scaled, cy + scaled);
      rim.addColorStop(0, "rgba(220,240,255,0.95)");
      rim.addColorStop(0.55, "rgba(148,226,255,0.4)");
      rim.addColorStop(1, "rgba(148,226,255,0.15)");
      context.beginPath();
      path({ type: "Sphere" });
      context.strokeStyle = rim;
      context.lineWidth = 1.5;
      context.stroke();

      if (orbitFade > 0) {
        context.save();
        context.translate(cx, cy);
        for (const orbit of orbits) {
          const angle = now * orbit.speed + orbit.phase;
          for (let tail = 0; tail < 14; tail++) {
            const a = angle - Math.sign(orbit.speed) * tail * 0.045;
            const ox = Math.cos(a) * scaled * orbit.rx;
            const oy = Math.sin(a) * scaled * orbit.ry;
            const x = ox * Math.cos(orbit.tilt) - oy * Math.sin(orbit.tilt);
            const y = ox * Math.sin(orbit.tilt) + oy * Math.cos(orbit.tilt);
            const behind = Math.sin(a) < 0 && Math.hypot(x, y) < scaled;
            if (behind) continue;
            context.beginPath();
            context.arc(x, y, tail === 0 ? 2.6 : 1.6 * (1 - tail / 14), 0, Math.PI * 2);
            context.fillStyle = orbit.hue;
            context.globalAlpha = orbitFade * (tail === 0 ? 1 : 0.5 * (1 - tail / 14));
            context.shadowColor = orbit.hue;
            context.shadowBlur = tail === 0 ? 12 : 0;
            context.fill();
          }
        }
        context.restore();
        context.globalAlpha = 1;
        context.shadowBlur = 0;
      }

      const flare = context.createRadialGradient(cx - scaled * 0.8, cy - scaled * 0.74, 0, cx - scaled * 0.8, cy - scaled * 0.74, scaled * 0.42);
      flare.addColorStop(0, "rgba(255,255,255,0.95)");
      flare.addColorStop(0.18, "rgba(200,230,255,0.45)");
      flare.addColorStop(1, "rgba(120,170,255,0)");
      context.globalCompositeOperation = "lighter";
      context.fillStyle = flare;
      context.fillRect(cx - scaled * 1.4, cy - scaled * 1.3, scaled * 1.2, scaled * 1.2);
      context.globalCompositeOperation = "source-over";

      const places = [
        { name: "RONDÔNIA", at: [-62, -11] as [number, number] },
        { name: "MIOMBO", at: [28, -12] as [number, number] },
        { name: "KALIMANTAN", at: [113.4, -1.75] as [number, number] },
        { name: "PAPUA", at: [140.25, -8.1] as [number, number] },
      ];
      const arc = (from: [number, number], to: [number, number], tone: string, index: number) => {
        const route = geoInterpolate(from, to);
        let moved = false;
        context.beginPath();
        for (let step = 0; step <= 48; step++) {
          const t = step / 48;
          const coordinates = route(t);
          if (!isFrontFacing(coordinates, center)) {
            moved = false;
            continue;
          }
          const xy = projection(coordinates);
          if (!xy) continue;
          const lift = 1 + 0.2 * Math.sin(Math.PI * t);
          const x = cx + (xy[0] - cx) * lift;
          const y = cy + (xy[1] - cy) * lift;
          if (!moved) context.moveTo(x, y);
          else context.lineTo(x, y);
          moved = true;
        }
        context.strokeStyle = tone;
        context.lineWidth = 1.4;
        context.shadowColor = tone;
        context.shadowBlur = 8;
        context.setLineDash([6, 8]);
        context.lineDashOffset = calm ? 0 : -(now / 38 + index * 9);
        context.stroke();
        context.setLineDash([]);
        context.shadowBlur = 0;
      };
      if (!flight) {
        arc(places[0].at, places[1].at, "#ff7a1a", 0);
        arc(places[1].at, places[2].at, "#ff7a1a", 1);
        arc(places[2].at, places[3].at, "#ff7a1a", 2);
      }

      const revealed = show || hover || focused || flight;
      for (const [index, place] of places.entries()) {
        if (flight || !isFrontFacing(place.at, center)) continue;
        const xy = projection(place.at);
        if (!xy) continue;
        const phase = calm ? 0.3 : (now / 2200 + index * 0.27) % 1;
        context.beginPath();
        context.arc(xy[0], xy[1], 5 + phase * 13, 0, Math.PI * 2);
        context.strokeStyle = `rgba(94,234,212,${0.8 * (1 - phase)})`;
        context.lineWidth = 1;
        context.stroke();
        context.beginPath();
        context.arc(xy[0], xy[1], 3.2, 0, Math.PI * 2);
        context.fillStyle = "#5eead4";
        context.shadowColor = "#5eead4";
        context.shadowBlur = 10;
        context.fill();
        context.shadowBlur = 0;
        context.font = `600 9.5px ${family}`;
        context.fillStyle = "rgba(255,255,255,0.88)";
        context.fillText(place.name, xy[0] + 8, xy[1] - 7);
      }
      projected = [];
      if (show) {
        for (const [index, point] of pointsRef.current.entries()) {
          const coordinates: [number, number] = [point.lng, point.lat];
          if (!isFrontFacing(coordinates, center)) continue;
          const xy = projection(coordinates);
          if (!xy) continue;
          projected.push({ point, x: xy[0], y: xy[1] });
          const isActive = active?.id === point.id;
          const base = Math.min(3.2, 1.1 + Math.log10(point.count + 1) * 0.55) * Math.min(1, size.radius / 250);
          context.beginPath();
          context.arc(xy[0], xy[1], isActive ? 4.2 : base, 0, Math.PI * 2);
          context.fillStyle = isActive ? "#fff7ed" : "rgba(255,112,64,0.92)";
          context.fill();
          if (isActive) {
            context.beginPath();
            context.arc(xy[0], xy[1], 12, 0, Math.PI * 2);
            context.strokeStyle = "#ffffff";
            context.lineWidth = 1;
            context.stroke();
          }
        }
      }
      const lock = held ?? flight?.target ?? null;
      if (lock && isFrontFacing([lock.lng, lock.lat], center)) {
        const at = projection([lock.lng, lock.lat]);
        if (at) {
          const beat = motion.matches ? 0 : (performance.now() / 900) % 1;
          const reach = 24 - 7 * Math.sin(beat * Math.PI);
          context.strokeStyle = "#ffffff";
          context.lineWidth = 1.6;
          for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            context.beginPath();
            context.moveTo(at[0] + sx * reach, at[1] + sy * (reach - 9));
            context.lineTo(at[0] + sx * reach, at[1] + sy * reach);
            context.lineTo(at[0] + sx * (reach - 9), at[1] + sy * reach);
            context.stroke();
          }
          context.beginPath();
          context.arc(at[0], at[1], 3, 0, Math.PI * 2);
          context.fillStyle = "#ffffff";
          context.fill();
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
      if (ret && home) {
        const back = Math.min(1, (time - ret.start) / 1100);
        const eased = 1 - (1 - back) ** 3;
        rotation = [
          ret.from[0] + (home.rotation[0] - ret.from[0]) * eased,
          ret.from[1] + (home.rotation[1] - ret.from[1]) * eased,
          0,
        ];
        zoom = ret.fromZoom + (home.zoom - ret.fromZoom) * eased;
        render();
        if (back >= 1) {
          ret = null;
          held = null;
          home = null;
          navigating = false;
          navigationDone = false;
          setActive(null);
          onRelease?.();
          render();
          schedule();
        } else schedule();
        return;
      }
      if (held && !flight) {
        render();
        if (!motion.matches) schedule();
        return;
      }
      if (flight) {
        const progress = motion.matches ? 1 : Math.min(1, (time - flight.start) / 1200);
        const eased = 1 - (1 - progress) ** 3;
        const delta = ((-flight.target.lng - flight.rotation[0] + 540) % 360 + 360) % 360 - 180;
        rotation = [flight.rotation[0] + delta * eased,
          flight.rotation[1] + (-flight.target.lat - flight.rotation[1]) * eased, 0];
        zoom = flight.zoom + (4.5 - flight.zoom) * eased;
        render();
        if (progress === 1) {
          const target = flight.target;
          finishLocation(target);
        } else schedule();
        return;
      }
      if (!isPaused && !hover && !focused && !dragging)
        rotation[0] += elapsed * 0.004;
      render();
      if (!motion.matches || (!isPaused && !hover && !focused && !dragging)) schedule();
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
      if (!canvas || navigating) return;
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
      if (!canvas || navigating || (event.pointerType === "mouse" && event.button !== 0))
        return;
      const rect = canvas.getBoundingClientRect();
      if (Math.hypot(event.clientX - rect.left - size.width / 2,
        event.clientY - rect.top - size.height / 2) > size.radius * zoom) return;
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
        const location = projection.invert([x, y]);
        if (Math.hypot(x - size.width / 2, y - size.height / 2) <= size.radius * zoom && location)
          openLocation(hit?.point ?? { lng: location[0], lat: location[1] }, hit?.point);
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
      if (navigating) return;
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
      if (navigating) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const location = projection.invert([size.width / 2, size.height / 2]);
        if (location) openLocation({ lng: location[0], lat: location[1] });
        return;
      }
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
    function openLocation(target: GlobeLocation, hotspot?: GlobeHotspot) {
      if (navigating) return;
      navigating = true;
      pending = hotspot;
      home = { rotation: [...rotation], zoom };
      onFlightStart?.(target);
      if (motion.matches) { finishLocation(target); return; }
      flight = { target, start: performance.now(), rotation: [...rotation], zoom };
      // The card must open even when the browser throttles Canvas frames.
      navigationTimer = window.setTimeout(() => finishLocation(target), 1250);
      schedule();
    }
    function release() {
      if (!held || ret) return;
      if (motion.matches || !home) {
        held = null;
        home = null;
        navigating = false;
        navigationDone = false;
        setActive(null);
        onRelease?.();
        render();
        return;
      }
      ret = { from: [...rotation], fromZoom: zoom, start: performance.now() };
      schedule();
    }
    function finishLocation(target: GlobeLocation) {
      if (navigationDone || controller.signal.aborted) return;
      navigationDone = true;
      flight = null;
      held = target;
      if (navigationTimer !== null) clearTimeout(navigationTimer);
      onLocationSelect?.(target, pending);
    }
    controls.current = {
      redraw() { setActive(null); render(); },
      zoom(factor) {
        if (flight) return;
        zoom = constrainZoom(zoom * factor);
        render();
      },
      reset() {
        if (flight) return;
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
        if (!show) setActive(null);
        render();
      },
    };
    if (controlRef) controlRef.current = { release };
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
      fetch("/geo/land-dots-fine.json", { signal: controller.signal }),
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
      if (navigationTimer !== null) clearTimeout(navigationTimer);
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      motion.removeEventListener("change", motionChange);
      controls.current = null;
      if (controlRef) controlRef.current = null;
    };
  }, [width, height, onHotspotChange, onLocationSelect, onFlightStart, onRelease, controlRef]);

  return (
    <div ref={hostRef} className={`earth-visualization ${opening ? "earth-opening" : ""} ${className}`} aria-busy={opening}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="link"
        aria-label={t(
          "Globe hotspot FIRMS global. Geser atau tombol panah untuk memutar; plus/minus untuk zoom. Klik lokasi atau tekan Enter untuk membuka peta.",
          "Global FIRMS hotspot globe. Drag or use arrow keys to rotate; plus/minus zoom. Click a location or press Enter to open the map.",
        )}
      />
      {opening && <div className="earth-opening-label" role="status">{t("Membuka peta lokasi…", "Opening location map…")}</div>}
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
        inert={opening}
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
          {t("Hotspot FIRMS", "FIRMS hotspots")}
        </button>
      </div>
    </div>
  );
}
