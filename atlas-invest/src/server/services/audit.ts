// AuditLogService — append-only history of user, system and agent actions.

import type { Tx } from "@/server/db";

export type Actor = "user" | "system" | "agent";

export async function audit(tx: Tx, userId: string | null, actor: Actor, action: string, entity: string, entityId: string | null, details: Record<string, unknown> = {}): Promise<void> {
  await tx.query(`insert into audit_log(user_id, actor, action, entity, entity_id, details) values ($1,$2,$3,$4,$5,$6)`, [userId, actor, action, entity, entityId, JSON.stringify(details)]);
}

export interface AuditRow {
  id: string;
  actor: Actor;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export async function listAudit(tx: Tx, limit = 100): Promise<AuditRow[]> {
  return tx.query<AuditRow>(`select id::text, actor, action, entity, entity_id, details, created_at from audit_log order by created_at desc, id desc limit $1`, [limit]);
}
