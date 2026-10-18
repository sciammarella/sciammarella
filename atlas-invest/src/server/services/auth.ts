// Email/password authentication with server-side sessions.
// Passwords: scrypt (N=16384, r=8, p=1) with a per-user salt.
// Sessions: random 32-byte token in an httpOnly cookie; only its SHA-256 is stored.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { uuid, withSystem, type Tx } from "@/server/db";
import { audit } from "./audit";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const SESSION_COOKIE = "atlas_session";
const SESSION_DAYS = 14;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(key, expected);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  isDemo: boolean;
}

export class AuthError extends Error {}

export function validateCredentials(email: string, password: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("Informe um e-mail válido.");
  if (password.length < 8) throw new AuthError("A senha deve ter pelo menos 8 caracteres.");
}

export async function createUser(tx: Tx, email: string, password: string, displayName: string, isDemo = false): Promise<string> {
  const normalized = email.trim().toLowerCase();
  validateCredentials(normalized, password);
  const [exists] = await tx.query(`select 1 from users where email = $1`, [normalized]);
  if (exists) throw new AuthError("Já existe uma conta com este e-mail.");
  const id = uuid();
  await tx.query(`insert into users(id, email, password_hash, display_name, is_demo) values ($1,$2,$3,$4,$5)`, [id, normalized, await hashPassword(password), displayName.trim() || normalized.split("@")[0], isDemo]);
  await audit(tx, id, "user", "account.created", "user", id, { email: normalized });
  return id;
}

export async function signUp(email: string, password: string, displayName: string): Promise<{ userId: string; token: string }> {
  return withSystem(async (tx) => {
    const userId = await createUser(tx, email, password, displayName);
    const token = await createSession(tx, userId);
    return { userId, token };
  });
}

export async function signIn(email: string, password: string): Promise<{ userId: string; token: string }> {
  return withSystem(async (tx) => {
    const [u] = await tx.query<{ id: string; password_hash: string }>(`select id, password_hash from users where email = $1`, [email.trim().toLowerCase()]);
    if (!u || !(await verifyPassword(password, u.password_hash))) throw new AuthError("E-mail ou senha incorretos.");
    const token = await createSession(tx, u.id);
    await audit(tx, u.id, "user", "session.created", "session", null);
    return { userId: u.id, token };
  });
}

export async function createSession(tx: Tx, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await tx.query(`insert into sessions(id, user_id, expires_at) values ($1,$2, now() + ($3 || ' days')::interval)`, [sha256(token), userId, String(SESSION_DAYS)]);
  await tx.query(`delete from sessions where expires_at < now()`);
  return token;
}

export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  return withSystem(async (tx) => {
    const [r] = await tx.query<{ id: string; email: string; display_name: string; is_demo: boolean }>(
      `select u.id, u.email, u.display_name, u.is_demo from sessions s join users u on u.id = s.user_id where s.id = $1 and s.expires_at > now()`,
      [sha256(token)],
    );
    return r ? { id: r.id, email: r.email, displayName: r.display_name, isDemo: r.is_demo } : null;
  });
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await withSystem((tx) => tx.query(`delete from sessions where id = $1`, [sha256(token)]));
}

export const SESSION_MAX_AGE = SESSION_DAYS * 86400;
