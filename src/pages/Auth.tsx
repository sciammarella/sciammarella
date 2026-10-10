import { FlaskConical, Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBackend } from "@/hooks/backend";
import { showError } from "@/lib/errors";

export default function AuthPage({ mode }: { mode: "signin" | "signup" }) {
  const { backend, session } = useBackend();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? "/app";

  if (session) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const res = await backend.signUp(email, password, fullName);
        if (res.confirmEmail) setConfirmSent(true);
        else navigate("/app", { replace: true });
      } else {
        await backend.signIn(email, password);
        navigate(from, { replace: true });
      }
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <Link to="/">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-2xl font-semibold">{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signup" ? "Set up your first flight mission in minutes." : "Sign in to check on your flight missions."}
          </p>

          {backend.kind === "browser" && (
            <Alert variant="demo" className="mt-6">
              <FlaskConical />
              <AlertDescription>
                Browser demo: your account and data are stored only in this browser. Connect Supabase for real authentication.
              </AlertDescription>
            </Alert>
          )}

          {confirmSent ? (
            <Alert variant="signal" className="mt-6">
              <AlertDescription>Check your inbox — we sent a confirmation link to {email}.</AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  minLength={8}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {mode === "signup" && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
              </div>
              <Button type="submit" className="w-full" size="lg" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {mode === "signup" ? "Create account" : "Sign in"}
              </Button>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signup" ? (
              <>
                Already have an account? <Link to="/signin" className="font-medium text-foreground underline-offset-4 hover:underline">Sign in</Link>
              </>
            ) : (
              <>
                New to FareBuddy? <Link to="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">Create an account</Link>
              </>
            )}
          </p>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-primary lg:block">
        <div className="bg-grid absolute inset-0 opacity-10" />
        <div className="relative flex h-full flex-col justify-end p-12 text-primary-foreground">
          <blockquote className="max-w-md">
            <p className="font-display text-3xl font-semibold leading-tight">“Set the price once. Stop refreshing fare sites forever.”</p>
            <p className="mt-4 text-sm text-primary-foreground/60">FareBuddy books only within the exact conditions you authorize.</p>
          </blockquote>
        </div>
      </div>
    </div>
  );
}
