// Optional email delivery via Resend. In-app notifications always work; email
// is sent only when RESEND_API_KEY and NOTIFICATION_FROM_EMAIL are configured.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { NewNotification } from "./engine/store.ts";

export async function sendNotificationEmail(db: SupabaseClient, n: NewNotification): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("NOTIFICATION_FROM_EMAIL");
  if (!apiKey || !from) return false;
  const { data } = await db.from("profiles").select("email").eq("id", n.userId).maybeSingle();
  if (!data?.email) return false;
  const appUrl = Deno.env.get("APP_URL") ?? "";
  const link = n.missionId && appUrl ? `${appUrl}/app/missions/${n.missionId}` : appUrl;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [data.email],
      subject: `FareBuddy: ${n.title}`,
      text: `${n.body}\n\n${link ? `Open FareBuddy: ${link}` : ""}`,
    }),
  });
  return res.ok;
}
