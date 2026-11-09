export type Candidate = {
  id: string;
  name: string;
  district: string;
  lat: number;
  lng: number;
  hours: number;
  repeats: number;
  anomaly: number;
  priority: "Tinggi" | "Sedang";
  sensor: string;
};
export { studyRegions as regions } from "./regions";
export const candidates: Record<string, Candidate[]> = {
  kalteng: [
    {
      id: "kt-1",
      name: "Sebangau",
      district: "Palangka Raya",
      lat: -2.56,
      lng: 113.91,
      hours: 2,
      repeats: 5,
      anomaly: 96,
      priority: "Tinggi",
      sensor: "VIIRS · NOAA-20",
    },
    {
      id: "kt-2",
      name: "Kahayan Kuala",
      district: "Pulang Pisau",
      lat: -3.08,
      lng: 114.13,
      hours: 4,
      repeats: 4,
      anomaly: 93,
      priority: "Tinggi",
      sensor: "VIIRS · S-NPP",
    },
    {
      id: "kt-3",
      name: "Kapuas Kuala",
      district: "Kapuas",
      lat: -3.13,
      lng: 114.55,
      hours: 7,
      repeats: 3,
      anomaly: 82,
      priority: "Sedang",
      sensor: "MODIS · Aqua",
    },
    {
      id: "kt-4",
      name: "Katingan Hilir",
      district: "Katingan",
      lat: -1.94,
      lng: 113.38,
      hours: 28,
      repeats: 2,
      anomaly: 75,
      priority: "Sedang",
      sensor: "VIIRS · NOAA-20",
    },
  ],
  papua: [
    {
      id: "pp-1",
      name: "Kurik",
      district: "Merauke",
      lat: -8.32,
      lng: 140.24,
      hours: 3,
      repeats: 4,
      anomaly: 95,
      priority: "Tinggi",
      sensor: "VIIRS · NOAA-20",
    },
    {
      id: "pp-2",
      name: "Tanah Miring",
      district: "Merauke",
      lat: -8.18,
      lng: 140.55,
      hours: 6,
      repeats: 3,
      anomaly: 89,
      priority: "Tinggi",
      sensor: "VIIRS · S-NPP",
    },
    {
      id: "pp-3",
      name: "Jagebob",
      district: "Merauke",
      lat: -7.92,
      lng: 140.73,
      hours: 12,
      repeats: 2,
      anomaly: 78,
      priority: "Sedang",
      sensor: "MODIS · Aqua",
    },
    {
      id: "pp-4",
      name: "Animha",
      district: "Merauke",
      lat: -8.01,
      lng: 140.16,
      hours: 32,
      repeats: 2,
      anomaly: 70,
      priority: "Sedang",
      sensor: "VIIRS · NOAA-20",
    },
  ],
};
export const series = Array.from({ length: 14 }, (_, i) => ({
  day: `${i + 1} Nov`,
  historical: [8, 10, 7, 9, 12, 11, 8, 9, 10, 12, 9, 11, 10, 12][i],
  current: [7, 12, 8, 11, 10, 15, 12, 18, 15, 22, 25, 20, 31, 28][i],
}));
