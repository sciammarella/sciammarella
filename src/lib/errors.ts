import { toast } from "sonner";
import { BackendError } from "@/backend";

export function showError(err: unknown, fallback = "Something went wrong") {
  if (err instanceof BackendError) {
    toast.error(err.message, { description: err.details.length ? err.details.join(" · ") : undefined });
  } else if (err instanceof Error) {
    toast.error(err.message || fallback);
  } else {
    toast.error(fallback);
  }
}
