import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { withUser } from "@/server/db";
import { audit } from "@/server/services/audit";

export const dynamic = "force-dynamic";

// LGPD data portability: everything the user owns, read through row-level security.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const data = await withUser(user.id, async (tx) => {
    const q = (sql: string) => tx.query(sql);
    const out = {
      exportedAt: new Date().toISOString(),
      user: (await q(`select id, email, display_name, created_at from users`))[0],
      profile: await q(`select answers, derived, methodology_version, updated_at from investment_profiles`),
      preferences: await q(`select notifications, thresholds from user_preferences`),
      portfolios: await q(`select * from portfolios`),
      positions: await q(`select * from positions`),
      targetAllocations: await q(`select * from target_allocations`),
      recommendations: await q(`select * from recommendations`),
      recommendationEvidence: await q(`select * from recommendation_evidence`),
      monitoringRuns: await q(`select * from monitoring_runs`),
      alerts: await q(`select * from alerts`),
      notifications: await q(`select * from notifications`),
      auditLog: await q(`select * from audit_log`),
    };
    await audit(tx, user.id, "user", "data.exported", "user", user.id);
    return out;
  });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="atlas-dados-${new Date().toISOString().slice(0, 10)}.json"` },
  });
}
