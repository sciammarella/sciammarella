import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "@/components/AppShell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BackendProvider, useBackend } from "@/hooks/backend";
import AuthPage from "@/pages/Auth";
import BookingDetail from "@/pages/BookingDetail";
import Bookings from "@/pages/Bookings";
import Dashboard from "@/pages/Dashboard";
import Landing from "@/pages/Landing";
import MissionDetail from "@/pages/MissionDetail";
import Missions from "@/pages/Missions";
import MissionWizard from "@/pages/MissionWizard";
import NotFound from "@/pages/NotFound";
import Notifications from "@/pages/Notifications";
import Passengers from "@/pages/Passengers";
import Payments from "@/pages/Payments";
import SettingsPage from "@/pages/Settings";

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, sessionLoading } = useBackend();
  const location = useLocation();
  if (sessionLoading) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  if (!session) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BackendProvider>
      <TooltipProvider delayDuration={200}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/signin" element={<AuthPage mode="signin" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            <Route
              path="/app"
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="missions" element={<Missions />} />
              <Route path="missions/new" element={<MissionWizard />} />
              <Route path="missions/:id" element={<MissionDetail />} />
              <Route path="missions/:id/edit" element={<MissionWizard />} />
              <Route path="bookings" element={<Bookings />} />
              <Route path="bookings/:id" element={<BookingDetail />} />
              <Route path="passengers" element={<Passengers />} />
              <Route path="payments" element={<Payments />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-center" richColors closeButton />
      </TooltipProvider>
    </BackendProvider>
  );
}
