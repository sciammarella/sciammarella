import Link from "next/link";
import { getCurrentProfile, requireUser } from "@/lib/session";
import { OnboardingWizard } from "./wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser();
  const profile = await getCurrentProfile(user.id);
  return (
    <div className="min-h-screen bg-muted/40 px-4 py-10">
      <div className="mx-auto mb-8 flex max-w-2xl items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-teal-400 to-sky-600 text-sm font-bold text-white">A</span>
          <span className="font-semibold">Atlas Invest AI</span>
        </Link>
        {profile && <Link href="/dashboard" className="text-sm text-muted-foreground underline">Voltar ao dashboard</Link>}
      </div>
      <OnboardingWizard initial={profile?.answers ?? null} />
    </div>
  );
}
