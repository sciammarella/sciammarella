import { NextResponse } from "next/server";
import { ensureReady } from "@/server/bootstrap";
import { driverKind, withSystem } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureReady();
    const [r] = await withSystem((tx) => tx.query<{ n: number }>(`select count(*)::int as n from assets`));
    return NextResponse.json({ ok: true, db: await driverKind(), assets: r.n });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
