"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUpRight,
  ArrowRightLeft,
  CalendarDays,
  Flame,
  Layers,
  ShieldCheck,
} from "lucide-react";
import { CountUp } from "@/components/count-up";
import { ScrambleText } from "@/components/scramble-text";
import RotatingEarth, {
  type GlobeHandle,
  type GlobeHotspot,
} from "@/components/ui/wireframe-dotted-globe";
import { studyRegions, type Language } from "@/lib/regions";

export default function HomePage() {
  const [language, setLanguage] = useState<Language>("id");
  const [active, setActive] = useState<GlobeHotspot | null>(null);
  const router = useRouter();
  const t = (id: string, en: string) => (language === "id" ? id : en);
  const [phase, setPhase] = useState<"idle" | "flying" | "card" | "warp">(
    "idle",
  );
  const [selected, setSelected] = useState<GlobeHotspot | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const globe = useRef<GlobeHandle | null>(null);
  const cardTitle = useRef<HTMLHeadingElement>(null);
  const focusHotspot = useCallback(() => setPhase("flying"), []);
  const selectHotspot = useCallback((point: GlobeHotspot) => {
    setSelected(point);
    setCardOpen(true);
    setPhase("card");
  }, []);
  const releaseHotspot = useCallback(() => {
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
    const target = `/simulation?region=${selected.region}`;
    router.prefetch(target);
    setPhase("warp");
    window.setTimeout(() => router.push(target), 340);
  }, [router, selected]);
  useEffect(() => {
    if (!cardOpen) return;
    cardTitle.current?.focus({ preventScroll: true });
    if (window.innerWidth <= 1000)
      cardTitle.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [cardOpen]);
  useEffect(() => {
    if (!cardOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCard();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [cardOpen, closeCard]);
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
          <Flame size={24} strokeWidth={2} />
          <span className="landing-wordmark">
            PYRO<b>CHRONOS</b>
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
            <span className="landing-eyebrow">
              <i />
              {"// NASA SPACE APPS 2026 · MODIS ⇄ VIIRS"}
            </span>
            <h1 id="home-title">
              <span>
                <ScrambleText text={t("Lihat apinya.", "See the fire.").toUpperCase()} />
              </span>
              <span>
                <ScrambleText
                  text={t("Pahami polanya.", "Read the pattern.").toUpperCase()}
                  delay={350}
                />
              </span>
            </h1>
            <p className="landing-description">
              {t(
                "Dari satu titik di bumi, lihat cerita yang lebih besar. Jelajahi aktivitas kebakaran di Kalimantan dan Papua dengan perspektif dua sensor satelit.",
                "One point on Earth opens a bigger story. Explore fire activity in Kalimantan and Papua through the lens of two satellite sensors.",
              )}
            </p>
            <div className="landing-actions">
              <Link href="/simulation" className="landing-primary">
                {t("Jelajahi peta hotspot", "Explore hotspot map")}
                <ArrowUpRight size={20} />
              </Link>
              <a className="landing-ghost" href="#information">
                <ArrowDown size={16} />
                {t("Di balik titik api", "Behind the fire points")}
              </a>
            </div>
            <div className="landing-sensors">
              <div className="landing-sensor">
                <strong>MODIS</strong>
                <span>1 km · Terra / Aqua</span>
              </div>
              <span className="landing-sensor-link" aria-hidden="true">
                <ArrowRightLeft size={20} strokeWidth={1.5} />
              </span>
              <div className="landing-sensor">
                <strong>VIIRS</strong>
                <span>375 m · S-NPP</span>
              </div>
            </div>
            <p className="landing-sensor-note">
              {t(
                "Resolusi deteksi nominal. Data perlu diselaraskan sebelum dibandingkan.",
                "Nominal detection resolution. Data needs harmonization before comparison.",
              )}
            </p>
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
                {t("ILUSTRATIF · DEMO", "ILLUSTRATIVE · DEMO")}
              </span>
              <h2 id="hotspot-title" ref={cardTitle} tabIndex={-1}>
                {selected.name}
              </h2>
              <p className="landing-hotspot-place">
                {selected.district} ·{" "}
                {studyRegions.find((item) => item.id === selected.region)?.name[
                  language
                ]}
              </p>
              <div className="landing-hotspot-grid">
                <div className="landing-hotspot-tile">
                  <span>{t("Deteksi terakhir", "Latest detection")}</span>
                  <strong>
                    <CountUp value={selected.hours} locale={language} />
                    <i> {t("jam lalu", "h ago")}</i>
                  </strong>
                </div>
                <div className="landing-hotspot-tile">
                  <span>{t("Terulang", "Repeats")}</span>
                  <strong>
                    <CountUp value={selected.repeats} locale={language} />
                    <i>×</i>
                  </strong>
                </div>
                <div
                  className="landing-hotspot-tile landing-hotspot-ring"
                  style={{ "--p": selected.anomaly / 100 } as CSSProperties}
                >
                  <svg viewBox="0 0 80 80" aria-hidden="true">
                    <circle cx="40" cy="40" r="34" />
                    <circle
                      className="landing-hotspot-arc"
                      cx="40"
                      cy="40"
                      r="34"
                      pathLength="100"
                    />
                  </svg>
                  <b>
                    <CountUp value={selected.anomaly} locale={language} />
                  </b>
                  <span>{t("Persentil anomali", "Anomaly percentile")}</span>
                </div>
                <div className="landing-hotspot-tile">
                  <span>{t("Prioritas", "Priority")}</span>
                  <strong
                    className={
                      selected.priority === "Tinggi"
                        ? "landing-priority-high"
                        : "landing-priority-medium"
                    }
                  >
                    {selected.priority === "Tinggi"
                      ? t("Tinggi", "High")
                      : t("Sedang", "Medium")}
                  </strong>
                </div>
              </div>
              <p className="landing-hotspot-meta">
                {selected.lat.toFixed(4)}°, {selected.lng.toFixed(4)}° ·{" "}
                {selected.sensor}
              </p>
              <div className="landing-hotspot-actions">
                <button type="button" className="landing-ghost" onClick={closeCard}>
                  <ArrowLeft size={16} />
                  {t("Kembali ke globe", "Back to globe")}
                </button>
                <button type="button" className="landing-primary" onClick={openMap}>
                  {t("Buka di peta hotspot", "Open in hotspot map")}
                  <ArrowUpRight size={20} />
                </button>
              </div>
              <small className="landing-hotspot-note">
                {t(
                  "Titik dan angka ini contoh ilustratif, bukan deteksi atau kondisi terkini.",
                  "This point and its numbers are an illustrative example, not a live detection or current conditions.",
                )}
              </small>
            </aside>
          )}
          <div className="landing-earth-column">
            <div className="landing-earth-stage">
              <div className="landing-halo" aria-hidden="true" />
              <RotatingEarth
                language={language}
                onHotspotChange={setActive}
                onHotspotFocus={focusHotspot}
                onHotspotSelect={selectHotspot}
                onHotspotRelease={releaseHotspot}
                controlRef={globe}
              />
              <span className="landing-earth-caption">
                {t("BUMI, DALAM PERSPEKTIF", "EARTH, IN PERSPECTIVE")}
              </span>
              <aside className="landing-stat landing-stat-a" aria-label={t("Hasil evaluasi: galat", "Evaluation result: error")}>
                <span>{t("Galat per sel-bulan 1°", "Error per 1° cell-month")}</span>
                <strong>
                  −<CountUp value={90} locale={language} />%
                </strong>
                <small>
                  {t("MAE 130,6 → 12,5 setelah harmonisasi", "MAE 130.6 → 12.5 after harmonization")}
                </small>
                <em>{t("uji 2021–2025", "test 2021–2025")}</em>
              </aside>
              <aside className="landing-stat landing-stat-b" aria-label={t("Domain tervalidasi", "Validated domains")}>
                <span>{t("Domain tervalidasi", "Validated domains")}</span>
                <strong>
                  <CountUp value={5} locale={language} />
                  <i> / 10</i>
                </strong>
                <small>
                  {t("Kalteng dan Papua belum tervalidasi; estimasi ditahan", "Kalteng and Papua are not validated; estimates withheld")}
                </small>
              </aside>
              <aside className="landing-stat landing-stat-c" aria-label={t("Arsip data", "Data archive")}>
                <span>{t("Arsip MODIS", "MODIS archive")}</span>
                <strong>
                  <CountUp value={26} locale={language} />
                  <i> {t("tahun", "years")}</i>
                </strong>
                <small>MODIS 2000–2025 · VIIRS 2012–2025</small>
              </aside>
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
            <p className="landing-caption">
              {t(
                "Titik api di globe adalah ilustrasi, bukan kondisi terkini. Statistik: evaluasi retrospektif model beku (evaluation-275ac4d8).",
                "Fire points on the globe are illustrative, not current conditions. Statistics: retrospective evaluation of the frozen model (evaluation-275ac4d8).",
              )}
            </p>
          </div>
        </section>
        <div className="landing-marquee" aria-hidden="true">
          <div className="landing-marquee-track">
            {[0, 1].map((copy) => (
              <ul key={copy}>
                {[
                  "MODIS 1 KM ⇄ VIIRS 375 M",
                  t("26 TAHUN ARSIP", "26 YEARS OF ARCHIVE"),
                  t("5 DOMAIN TERVALIDASI", "5 VALIDATED DOMAINS"),
                  t("GALAT −90%", "ERROR −90%"),
                  t("NULL BUKAN NOL", "NULL IS NOT ZERO"),
                  "NASA SPACE APPS 2026",
                ].map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ))}
          </div>
        </div>
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
              <span className="landing-outline">
                {t("Satu konteks.", "One context.")}
              </span>
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
            <div className="landing-features">
              <article className="landing-feature" data-index="01">
                <Layers size={22} strokeWidth={1.5} />
                <h3>{t("Satu skala", "One scale")}</h3>
                <p>
                  {t(
                    "VIIRS 375 m diubah ke skala setara MODIS dengan model yang diuji pada tahun yang tidak dipakai untuk melatihnya.",
                    "VIIRS 375 m is mapped to a MODIS-equivalent scale by a model tested on years it was never trained on.",
                  )}
                </p>
              </article>
              <article className="landing-feature" data-index="02">
                <CalendarDays size={22} strokeWidth={1.5} />
                <h3>{t("Kalender anomali", "Anomaly calendar")}</h3>
                <p>
                  {t(
                    "Setiap bulan dibandingkan dengan sepuluh tahun sebelumnya pada rentang tanggal yang sama, dalam persentil.",
                    "Each month is ranked against the previous ten years of the same dates, as a percentile.",
                  )}
                </p>
              </article>
              <article className="landing-feature" data-index="03">
                <ShieldCheck size={22} strokeWidth={1.5} />
                <h3>{t("Jujur soal data", "Honest about data")}</h3>
                <p>
                  {t(
                    "Data kosong atau wilayah yang belum divalidasi ditandai terang, bukan ditampilkan sebagai nol kebakaran.",
                    "Missing data and unvalidated regions are marked plainly, never shown as zero fires.",
                  )}
                </p>
              </article>
            </div>
        </section>
      </main>
      <div className="landing-warp" aria-hidden="true" />
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
