import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { ensureReady } from "@/server/bootstrap";
import { withUser } from "@/server/db";
import { getSessionUser, SESSION_COOKIE, type SessionUser } from "@/server/services/auth";
import { getProfile, type StoredProfile } from "@/server/services/profile";

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  await ensureReady();
  const store = await cookies();
  return getSessionUser(store.get(SESSION_COOKIE)?.value);
});

export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export const getCurrentProfile = cache(async (userId: string): Promise<StoredProfile | null> => withUser(userId, (tx) => getProfile(tx)));

export async function requireProfile(): Promise<{ user: SessionUser; profile: StoredProfile }> {
  const user = await requireUser();
  const profile = await getCurrentProfile(user.id);
  if (!profile) redirect("/onboarding");
  return { user, profile };
}
