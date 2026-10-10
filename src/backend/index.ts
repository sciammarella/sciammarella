import { LocalBackend } from "./local";
import { SupabaseBackend } from "./supabase";
import type { Backend } from "./types";

export * from "./types";

let instance: Backend | null = null;

export function getBackend(): Backend {
  if (instance) return instance;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  instance = url && key ? new SupabaseBackend(url, key) : new LocalBackend();
  return instance;
}
