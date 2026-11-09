import { NextRequest, NextResponse } from "next/server";
import { getRegion } from "@/lib/regions";
export async function GET(req: NextRequest) {
  const region = req.nextUrl.searchParams.get("region") || "kalteng";
  const studyRegion = getRegion(region);
  if (!studyRegion)
    return NextResponse.json(
      { error: "Wilayah tidak tersedia." },
      { status: 400 },
    );
  const key = process.env.FIRMS_MAP_KEY;
  if (!key)
    return NextResponse.json(
      {
        error: "FIRMS_MAP_KEY belum diatur. Dashboard tetap menggunakan demo.",
      },
      { status: 503 },
    );
  try {
    const source = "VIIRS_NOAA20_NRT";
    const response = await fetch(
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source}/${studyRegion.bounds.join(",")}/2`,
      { signal: AbortSignal.timeout(20000), next: { revalidate: 3600 } },
    );
    if (!response.ok) throw new Error("upstream");
    const csv = await response.text();
    if (!csv.startsWith("latitude,") && !csv.startsWith("country_id,"))
      throw new Error("format");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="firms-${region}.csv"`,
        "X-Pyro-Source": source,
        "X-Pyro-Calibration": "none",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Data FIRMS belum dapat diunduh. Coba kembali nanti." },
      { status: 502 },
    );
  }
}
