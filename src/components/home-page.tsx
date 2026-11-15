"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUpRight, ArrowRightLeft } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import RotatingEarth from "@/components/ui/wireframe-dotted-globe";
import { globeMapHref, globePoints, type GlobeHotspot, type GlobeLocation } from "@/lib/globe-geometry";
import type { Language } from "@/lib/regions";
import snapshot from "@/data/globe-hotspots.json";

const points = globePoints(snapshot.points);

export default function HomePage() {
  const [language, setLanguage] = useState<Language>("en");
  const [active, setActive] = useState<GlobeHotspot | null>(null);
  const router = useRouter();
  const t = (id: string, en: string) => (language === "id" ? id : en);
  const selectHotspot = useCallback(
    (point: GlobeLocation) => router.push(globeMapHref(point)),
    [router],
  );
  useEffect(() => { router.prefetch("/simulation"); }, [router]);
  const utc = (value: string) => `${new Date(value).toLocaleString(language === "id" ? "id-ID" : "en-GB", {
    timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  })} UTC`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem("pyro-language");
      if (saved === "id" || saved === "en") setLanguage(saved);
    } catch {
      /* Language works without local storage. */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  function changeLanguage(value: Language) {
    setLanguage(value);
    try {
      localStorage.setItem("pyro-language", value);
    } catch {
      /* Optional preference storage. */
    }
  }

  return (
    <div className="landing">
      <a className="landing-skip" href="#home-content">
        {t("Lewati ke konten", "Skip to content")}
      </a>
      <header className="landing-header">
        <Link href="/" className="landing-brand" aria-label="PyroChronos Home">
          <BrandMark size={40} />
          <span>
            PyroChronos<span className="landing-brand-dot">.</span>
          </span>
        </Link>
        <nav
          className="landing-nav"
          aria-label={t("Navigasi utama", "Main navigation")}
        >
          <Link href="/" aria-current="page">
            Home
          </Link>
          <Link href="/simulation">{t("Peta hotspot", "Hotspot map")}</Link>
          <a href="#information">{t("Tentang", "About")}</a>
        </nav>
        <div
          className="landing-language"
          role="group"
          aria-label={t("Bahasa", "Language")}
        >
          <button
            aria-pressed={language === "id"}
            onClick={() => changeLanguage("id")}
          >
            ID
          </button>
          <span>/</span>
          <button
            aria-pressed={language === "en"}
            onClick={() => changeLanguage("en")}
          >
            EN
          </button>
        </div>
      </header>
      <main id="home-content" className="landing-main">
        <section className="landing-hero" aria-labelledby="home-title">
          <div className="landing-intro">
            <h1 id="home-title">
              <span>{t("Lihat apinya.", "See the fire.")}</span>
              <span>{t("Pahami polanya.", "Read the pattern.")}</span>
            </h1>
            <p className="landing-description">
              {t(
                "Jelajahi rekaman tujuh hari deteksi panas di seluruh dunia dari NASA FIRMS. Pilih lokasi di globe untuk membuka peta.",
                "Explore a seven-day snapshot of heat detections worldwide from NASA FIRMS. Pick a place on the globe to open the map.",
              )}
            </p>
            <div className="landing-sensors">
              <div>
                <strong>MODIS</strong>
                <span>1 km</span>
              </div>
              <ArrowRightLeft size={22} strokeWidth={1.25} />
              <div>
                <strong>VIIRS</strong>
                <span>375 m</span>
              </div>
            </div>
            <p className="landing-sensor-note">
              {t(
                "Resolusi deteksi nominal. Data perlu diselaraskan sebelum dibandingkan.",
                "Nominal detection resolution. Data needs harmonization before comparison.",
              )}
            </p>
            <a className="landing-scroll" href="#information">
              <ArrowDown size={16} />
              {t("Di balik titik api", "Behind the fire points")}
            </a>
          </div>
          <div className="landing-earth-column">
            <div className="landing-earth-stage">
              <RotatingEarth
                language={language}
                hotspots={points}
                onHotspotChange={setActive}
                onLocationSelect={selectHotspot}
              />
              <span className="landing-earth-caption">
                {t("NASA FIRMS · SELURUH DUNIA", "NASA FIRMS · WORLDWIDE")}
              </span>
            </div>
            <div className="landing-readout" data-feed-state="snapshot" aria-live="polite">
              <span className="landing-feed-dot" />
              <div>
                <strong>
                  {active
                    ? `${active.count.toLocaleString()} ${t("deteksi di area ini", "detections in this area")}`
                    : `${snapshot.total.toLocaleString(language === "id" ? "id-ID" : "en-GB")} ${t("deteksi · 7 hari", "detections · 7 days")}`}
                </strong>
                <span>
                  {active
                    ? `${active.lat.toFixed(2)}°, ${active.lng.toFixed(2)}° · ${t("Terbaru", "Latest")} ${utc(active.observedAt)}`
                    : t("8–14 November 2026 UTC · snapshot tetap", "8–14 November 2026 UTC · fixed snapshot")}
                </span>
              </div>
            </div>
            <div className="landing-cta">
              <Link href="/simulation" className="landing-primary">
                {t("Jelajahi peta hotspot", "Explore hotspot map")}
                <ArrowUpRight size={20} />
              </Link>
              <p>
                {t(
                  "VIIRS NOAA-20 · titik mengelompokkan deteksi panas per area 2°, bukan konfirmasi kebakaran. Geser untuk memutar; klik untuk membuka peta terkini.",
                  "VIIRS NOAA-20 · points group heat detections into 2° areas, not confirmed fires. Drag to rotate; click to open the current map.",
                )}
              </p>
              <a className="landing-snapshot-source" href={snapshot.providerUrl} target="_blank" rel="noreferrer">
                {snapshot.attribution}<ArrowUpRight size={12} />
              </a>
            </div>
          </div>
        </section>
        <div className="landing-region-links">
          <span>{t("Wilayah studi", "Study regions")}</span>
          <Link href="/simulation?region=kalteng">
            {t("Kalimantan Tengah", "Central Kalimantan")}
            <ArrowUpRight size={15} />
          </Link>
          <Link href="/simulation?region=papua">
            {t("Papua Selatan", "South Papua")}
            <ArrowUpRight size={15} />
          </Link>
          <span>
            {t("Subset wilayah Indonesia", "Indonesian study subsets")}
          </span>
        </div>
        <section
          id="information"
          className="landing-information"
          aria-labelledby="information-title"
        >
          <div className="landing-information-inner">
            <h2 id="information-title">
              {t("Dua sensor.", "Two sensors.")}
              <br />
              {t("Satu konteks.", "One context.")}
            </h2>
            <div>
              <p>
                {t(
                  "Satelit mengamati bumi pada waktu, resolusi, dan sensitivitas yang berbeda. Lebih banyak titik belum tentu berarti lebih banyak api.",
                  "Satellites observe Earth at different times, resolutions and sensitivities. More points do not always mean more fire.",
                )}
              </p>
              <p>
                {t(
                  "PyroChronos dikembangkan untuk menyelaraskan catatan MODIS dan VIIRS dari NASA FIRMS. Tujuannya: membantu menilai aktivitas terbaru terhadap pola historis musiman, lalu memilih lokasi untuk diverifikasi.",
                  "PyroChronos is being developed to harmonize MODIS and VIIRS records from NASA FIRMS: placing recent activity in seasonal historical context to help choose locations for verification.",
                )}
              </p>
              <Link href="/simulation">
                {t("Mulai dari wilayah studi", "Start with a study region")}
                <ArrowUpRight size={18} />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <Link href="/" className="landing-brand">
          <BrandMark size={28} />
          PyroChronos.
        </Link>
        <span>NASA Space Apps Challenge 2026</span>
        <a
          href="https://www.naturalearthdata.com/"
          target="_blank"
          rel="noreferrer"
        >
          Made with Natural Earth <ArrowUpRight size={12} />
        </a>
      </footer>
    </div>
  );
}
