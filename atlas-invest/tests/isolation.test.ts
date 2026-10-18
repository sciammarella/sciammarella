// Data isolation: runs against a real (embedded) PostgreSQL with the production
// migrations and row-level security, as the restricted application role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDriver, resetDriverForTests, withSystem, withUser } from "@/server/db";
import { createUser } from "@/server/services/auth";
import { syncCatalog } from "@/server/services/market-data";
import { addPosition, createPortfolio, getPortfolio, listPortfolios } from "@/server/services/portfolio";
import { saveProfile } from "@/server/services/profile";
import { listAlerts } from "@/server/services/monitoring";
import { DEMO_PROFILE } from "@/server/bootstrap";

let alice = "";
let bob = "";
let alicePf = "";

beforeAll(async () => {
  await resetDriverForTests();
  await getDriver({ memory: true });
  await withSystem((tx) => syncCatalog(tx));
  alice = await withSystem((tx) => createUser(tx, "alice@test.local", "password-123", "Alice"));
  bob = await withSystem((tx) => createUser(tx, "bob@test.local", "password-123", "Bob"));
  alicePf = await withUser(alice, async (tx) => {
    await saveProfile(tx, alice, DEMO_PROFILE);
    const id = await createPortfolio(tx, alice, { name: "Alice PF", baseCurrency: "BRL" });
    await addPosition(tx, alice, { portfolioId: id, assetId: "BR-BOVA11", quantity: 10, avgPrice: 100, acquiredAt: "2026-01-02" });
    await tx.query(
      `insert into alerts(id, user_id, portfolio_id, rule, fingerprint, severity, title, what_changed, why_matters, affected, impact, suggested_action, evidence, uses_demo_data, analyzed_at)
       values (gen_random_uuid(), $1, $2, 'price_move', 'fp', 'attention', 't', 'w', 'y', '{}', '{}', 's', '[]', true, now())`,
      [alice, id],
    );
    return id;
  });
});

afterAll(async () => {
  await resetDriverForTests();
});

describe("row-level security", () => {
  it("owner sees their data", async () => {
    await withUser(alice, async (tx) => {
      expect((await listPortfolios(tx)).map((p) => p.name)).toEqual(["Alice PF"]);
      expect((await getPortfolio(tx, alicePf))?.positions).toHaveLength(1);
      expect(await listAlerts(tx)).toHaveLength(1);
    });
  });
  it("another user cannot read it, even querying by id or without filters", async () => {
    await withUser(bob, async (tx) => {
      expect(await listPortfolios(tx)).toEqual([]);
      expect(await getPortfolio(tx, alicePf)).toBeNull();
      expect(await tx.query(`select * from positions`)).toEqual([]);
      expect(await tx.query(`select * from investment_profiles`)).toEqual([]);
      expect(await listAlerts(tx)).toEqual([]);
      expect(await tx.query(`select * from audit_log`)).toEqual((await tx.query(`select * from audit_log where user_id = $1`, [bob])));
      expect((await tx.query<{ email: string }>(`select email from users`)).map((u) => u.email)).toEqual(["bob@test.local"]);
    });
  });
  it("another user cannot modify or delete it", async () => {
    await withUser(bob, async (tx) => {
      expect(await tx.query(`update portfolios set name = 'hacked' where id = $1 returning id`, [alicePf])).toEqual([]);
      expect(await tx.query(`delete from positions returning id`)).toEqual([]);
    });
    await withUser(alice, async (tx) => expect((await getPortfolio(tx, alicePf))?.portfolio.name).toBe("Alice PF"));
  });
  it("cannot insert rows on behalf of another user or attach to their portfolio", async () => {
    await expect(withUser(bob, (tx) => tx.query(`insert into portfolios(id, user_id, name, base_currency) values (gen_random_uuid(), $1, 'x', 'BRL')`, [alice]))).rejects.toThrow(/row-level security/);
    await expect(withUser(bob, (tx) => addPosition(tx, bob, { portfolioId: alicePf, assetId: "BR-BOVA11", quantity: 1, avgPrice: 1, acquiredAt: "2026-01-02" }))).rejects.toThrow(/does not belong/);
  });
  it("the application role cannot read sessions or password hashes of others, nor rewrite audit history", async () => {
    await expect(withUser(bob, (tx) => tx.query(`select * from sessions`))).rejects.toThrow(/permission denied/);
    await expect(withUser(alice, (tx) => tx.query(`delete from audit_log`))).rejects.toThrow(/permission denied/);
    await expect(withUser(alice, (tx) => tx.query(`update audit_log set action = 'x'`))).rejects.toThrow(/permission denied/);
  });
  it("rejects malformed user ids before touching the database", async () => {
    await expect(withUser("' or 1=1 --", async () => 1)).rejects.toThrow(/invalid user id/);
  });
});
