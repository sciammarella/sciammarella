// AES-256-GCM encryption for passenger records (WebCrypto: browser + Deno).
// Output format: base64(iv[12] || ciphertext+tag).

import type { PassengerDetails } from "./types.ts";

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(str: string): Uint8Array<ArrayBuffer> {
  const bin = atob(str);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function importPassengerKey(base64Key: string): Promise<CryptoKey> {
  const raw = b64decode(base64Key);
  if (raw.length !== 32) throw new Error("PASSENGER_DATA_KEY must be 32 bytes, base64-encoded");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function generatePassengerKey(): string {
  return b64encode(crypto.getRandomValues(new Uint8Array(32)));
}

export async function encryptPassenger(key: CryptoKey, details: PassengerDetails, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(details));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, key, plaintext));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64encode(out);
}

/** `aad` binds the ciphertext to its owner so blobs cannot be swapped between users. */
export async function decryptPassenger(key: CryptoKey, blob: string, aad: string): Promise<PassengerDetails> {
  const bytes = b64decode(blob);
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}
