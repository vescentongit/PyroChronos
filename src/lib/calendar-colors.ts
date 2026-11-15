export function calendarColors(layer: "count" | "anomaly", fraction: number | null) {
  if (fraction === null) return { background: "#171717", color: "#ffffff" };
  const value = Math.min(1, Math.max(0, fraction));
  const hue = layer === "count" || value < 0.5 ? 215 : 7;
  const saturation = layer === "count" || value < 0.5 ? 0.55 : 0.7;
  const lightness = (layer === "count" ? 92 - 70 * value : value < 0.5 ? 35 + 120 * value : 95 - 130 * (value - 0.5)) / 100;
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const step = (offset + hue / 30) % 12;
    return Math.round(255 * (lightness - amplitude * Math.max(-1, Math.min(step - 3, 9 - step, 1))));
  };
  const rgb = [channel(0), channel(8), channel(4)];
  const linear = rgb.map(n => n / 255 <= 0.04045 ? n / 255 / 12.92 : ((n / 255 + 0.055) / 1.055) ** 2.4);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return { background: `rgb(${rgb.join(", ")})`, color: 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? "#ffffff" : "#000000" };
}
