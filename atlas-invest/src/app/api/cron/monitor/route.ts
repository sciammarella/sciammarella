import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { ensureReady } from "@/server/bootstrap";
import { runScheduledForAll } from "@/server/services/monitoring";

export const dynamic = "force-dynamic";

// External scheduler entry point (e.g. Vercel Cron, GitHub Actions, cron + curl).
// Authorization: Bearer <CRON_SECRET>
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET não configurado" }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  await ensureReady();
  const r = await runScheduledForAll();
  return NextResponse.json({ ok: true, ...r });
}

export const GET = handle;
export const POST = handle;
