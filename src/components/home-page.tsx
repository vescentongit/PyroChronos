"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUpRight, ArrowRightLeft, Flame } from "lucide-react";
import RotatingEarth, {
  type GlobeHotspot,
} from "@/components/ui/wireframe-dotted-globe";
import type { Language } from "@/lib/regions";

export default function HomePage() {
  const [language, setLanguage] = useState<Language>("id");
  const [active, setActive] = useState<GlobeHotspot | null>(null);
  const router = useRouter();
  const t = (id: string, en: string) => (language === "id" ? id : en);
  const selectHotspot = useCallback(
    (point: GlobeHotspot) => router.push(`/simulation?region=${point.region}`),
    [router],
  );
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
          <Flame size={24} strokeWidth={1.6} />
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
                "Dari satu titik di bumi, lihat cerita yang lebih besar. Jelajahi aktivitas kebakaran di Kalimantan dan Papua dengan perspektif dua sensor satelit.",
                "One point on Earth opens a bigger story.",
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
                onHotspotChange={setActive}
                onHotspotSelect={selectHotspot}
              />
              <span className="landing-earth-caption">
                {t("BUMI, DALAM PERSPEKTIF", "EARTH, IN PERSPECTIVE")}
              </span>
            </div>
            <div className="landing-readout" aria-live="polite">
              <span className="landing-demo-dot" />
              <div>
                <strong>
                  {active
                    ? active.name
                    : t("Arahkan kursor ke globe.", "Hover over the globe.")}
                </strong>
                <span>
                  {active
                    ? `${active.sensor} · ${t("data ilustratif", "illustrative data")}`
                    : t(
                        "Geser untuk memutar. Sentuh Hotspot demo untuk menampilkan titik.",
                        "Drag to rotate. Tap Demo hotspots to reveal the points.",
                      )}
                </span>
              </div>
              <span className="landing-demo-label">DEMO</span>
            </div>
            <div className="landing-cta">
              <Link href="/simulation" className="landing-primary">
                {t("Jelajahi peta hotspot", "Explore hotspot map")}
                <ArrowUpRight size={20} />
              </Link>
              <p>
                {t(
                  "Jelajahi dashboard. Hotspot di globe adalah ilustrasi, bukan kondisi terkini.",
                  "Explore the dashboard. Globe hotspots are illustrative, not current conditions.",
                )}
              </p>
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
          <Flame size={20} strokeWidth={1.6} />
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
