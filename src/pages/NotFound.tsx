import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="font-display text-6xl font-semibold text-muted-foreground/40">404</div>
      <p className="text-muted-foreground">This page took a different flight.</p>
      <Button asChild>
        <Link to="/">Back home</Link>
      </Button>
    </div>
  );
}
