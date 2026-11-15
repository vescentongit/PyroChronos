"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUpRight, ArrowRightLeft } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import RotatingEarth, { type GlobeHandle } from "@/components/ui/wireframe-dotted-globe";
import { globeMapHref, globePoints, type GlobeHotspot, type GlobeLocation } from "@/lib/globe-geometry";
import type { Language } from "@/lib/regions";
import snapshot from "@/data/globe-hotspots.json";

const points = globePoints(snapshot.points);

export default function HomePage() {
  const [language, setLanguage] = useState<Language>("en");
  const [active, setActive] = useState<GlobeHotspot | null>(null);
  const router = useRouter();
  const t = (id: string, en: string) => (language === "id" ? id : en);
  const [phase, setPhase] = useState<"idle" | "flying" | "card" | "warp">("idle");
  const [selected, setSelected] = useState<{ place: GlobeLocation; hotspot?: GlobeHotspot } | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const globe = useRef<GlobeHandle | null>(null);
  const cardTitle = useRef<HTMLHeadingElement>(null);
  const startFlight = useCallback(() => setPhase("flying"), []);
  const selectHotspot = useCallback((place: GlobeLocation, hotspot?: GlobeHotspot) => {
    setSelected({ place, hotspot });
    setCardOpen(true);
    setPhase("card");
  }, []);
  const released = useCallback(() => {
    setSelected(null);
    setPhase("idle");
  }, []);
  const closeCard = useCallback(() => {
    setCardOpen(false);
    setPhase("idle");
    globe.current?.release();
  }, []);
  const openMap = useCallback(() => {
    if (!selected) return;
    const target = globeMapHref(selected.place);
    router.prefetch(target);
    setPhase("warp");
    window.setTimeout(() => router.push(target), 340);
  }, [router, selected]);
  useEffect(() => {
    if (!cardOpen) return;
    cardTitle.current?.focus({ preventScroll: true });
    if (window.innerWidth <= 1000) cardTitle.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCard();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [cardOpen, closeCard]);
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
    <div className="landing" data-phase={phase}>
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
          {selected && (
            <aside
              className="landing-hotspot"
              data-open={cardOpen ? "true" : "false"}
              role="dialog"
              aria-labelledby="hotspot-title"
              aria-modal="false"
            >
              <span className="landing-hotspot-tag">
                <i />
                {t("NASA FIRMS · VIIRS NOAA-20 · SNAPSHOT TETAP", "NASA FIRMS · VIIRS NOAA-20 · FIXED SNAPSHOT")}
              </span>
              <h2 id="hotspot-title" ref={cardTitle} tabIndex={-1}>
                {`${Math.abs(selected.place.lat).toFixed(2)}°${selected.place.lat < 0 ? "S" : "N"} · ${Math.abs(selected.place.lng).toFixed(2)}°${selected.place.lng < 0 ? "W" : "E"}`}
              </h2>
              <p className="landing-hotspot-place">
                {selected.hotspot
                  ? t("Area 2° × 2° yang dikelompokkan", "Grouped 2° × 2° area")
                  : t("Titik yang Anda pilih di globe", "The point you picked on the globe")}
              </p>
              {selected.hotspot ? (
                <dl className="landing-hotspot-grid">
                  <div className="landing-hotspot-tile">
                    <dt>{t("Deteksi di area ini", "Detections in this area")}</dt>
                    <dd>{selected.hotspot.count.toLocaleString(language === "id" ? "id-ID" : "en-GB")}</dd>
                  </div>
                  <div className="landing-hotspot-tile">
                    <dt>{t("Bagian dari snapshot", "Share of the snapshot")}</dt>
                    <dd>
                      {(100 * selected.hotspot.count / snapshot.total).toLocaleString(language === "id" ? "id-ID" : "en-GB", { maximumSignificantDigits: 2 })}
                      <i>%</i>
                    </dd>
                  </div>
                  <div className="landing-hotspot-tile landing-hotspot-wide">
                    <dt>{t("Deteksi terbaru", "Latest detection")}</dt>
                    <dd className="landing-hotspot-time">{utc(selected.hotspot.observedAt)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="landing-hotspot-empty">
                  {t(
                    "Tidak ada deteksi yang dikelompokkan di titik ini pada snapshot 8–14 November 2026. Itu belum berarti tidak ada api; buka peta untuk periode dan sensor lain.",
                    "No detections are grouped at this point in the 8–14 November 2026 snapshot. That does not mean there is no fire; open the map for other periods and sensors.",
                  )}
                </p>
              )}
              <div className="landing-hotspot-actions">
                <button type="button" className="landing-hotspot-back" onClick={closeCard}>
                  <ArrowLeft size={16} />
                  {t("Kembali ke globe", "Back to globe")}
                </button>
                <button type="button" className="landing-primary" onClick={openMap}>
                  {t("Buka di peta hotspot", "Open on the hotspot map")}
                  <ArrowUpRight size={18} />
                </button>
              </div>
              <small className="landing-hotspot-note">
                {t(
                  "Titik mengelompokkan deteksi panas per area 2°; ini bukan konfirmasi kebakaran.",
                  "Points group heat detections per 2° area; this is not a confirmed fire.",
                )}
              </small>
            </aside>
          )}
          <div className="landing-earth-column">
            <div className="landing-earth-stage">
              <RotatingEarth
                language={language}
                hotspots={points}
                onHotspotChange={setActive}
                onLocationSelect={selectHotspot}
                onFlightStart={startFlight}
                onRelease={released}
                controlRef={globe}
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
      <div className="landing-warp" aria-hidden="true" />
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
