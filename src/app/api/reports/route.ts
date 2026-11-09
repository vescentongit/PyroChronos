import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { candidates } from "@/lib/data";
export const runtime = "nodejs";
function authorized(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return false;
  const secret = process.env.COORDINATOR_TOKEN;
  if (!secret || secret.length < 32) return false;
  const received =
    req.headers.get("authorization") ||
    `Bearer ${req.cookies.get("pyro_session")?.value || ""}`;
  const expected = `Bearer ${secret}`;
  return (
    Buffer.byteLength(received) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  );
}
export async function GET(req: NextRequest) {
  if (!authorized(req))
    return NextResponse.json(
      { error: "Akses koordinator diperlukan." },
      { status: 401 },
    );
  if (!process.env.DATABASE_URL)
    return NextResponse.json(
      { error: "Neon belum dikonfigurasi." },
      { status: 503 },
    );
  try {
    return NextResponse.json(
      await getDb().inspectionReport.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
  } catch {
    return NextResponse.json(
      { error: "Laporan belum dapat dimuat." },
      { status: 503 },
    );
  }
}
const schema = z.object({
  requestId: z.string().uuid(),
  candidateId: z.string().refine((id) =>
    Object.values(candidates)
      .flat()
      .some((c) => c.id === id),
  ),
  observedAt: z
    .string()
    .datetime()
    .refine((t) => Date.parse(t) <= Date.now()),
  result: z.enum([
    "Api/asap ditemukan",
    "Tidak ditemukan tanda api saat pemeriksaan",
    "Belum dapat dipastikan",
  ]),
  notes: z.string().max(2000),
});
export async function POST(req: NextRequest) {
  if (!authorized(req))
    return NextResponse.json(
      { error: "Akses koordinator diperlukan." },
      { status: 401 },
    );
  if (!process.env.DATABASE_URL)
    return NextResponse.json(
      { error: "Neon belum dikonfigurasi." },
      { status: 503 },
    );
  let parsed;
  try {
    parsed = schema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: "JSON tidak valid." }, { status: 400 });
  }
  if (!parsed.success)
    return NextResponse.json(
      { error: "Data laporan tidak valid." },
      { status: 400 },
    );
  try {
    const report = await getDb().inspectionReport.upsert({
      where: { requestId: parsed.data.requestId },
      create: parsed.data,
      update: {},
    });
    return NextResponse.json(report, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Laporan belum tersimpan. Coba lagi." },
      { status: 503 },
    );
  }
}
