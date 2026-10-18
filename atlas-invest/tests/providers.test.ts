import { describe, expect, it } from "vitest";
import { parseAlphaVantage, parseBcbSeries, parseBrapi, parseCoinGeckoChart, parseTreasuryXml } from "@/server/providers";
import { parsePositionsCsv } from "@/server/services/portfolio";

describe("provider parsers (fixtures of real response formats)", () => {
  it("BCB SGS", () => {
    expect(parseBcbSeries([{ data: "16/10/2026", valor: "0.055131" }])).toEqual([{ date: "2026-10-16", value: 0.055131 }]);
    expect(() => parseBcbSeries({ erro: "x" })).toThrow();
  });
  it("U.S. Treasury yield curve XML", () => {
    const xml = `<feed><entry><content><m:properties><d:NEW_DATE m:type="Edm.DateTime">2026-10-16T00:00:00</d:NEW_DATE><d:BC_3MONTH m:type="Edm.Double">3.92</d:BC_3MONTH><d:BC_10YEAR m:type="Edm.Double">4.18</d:BC_10YEAR></m:properties></content></entry></feed>`;
    expect(parseTreasuryXml(xml)).toEqual([{ code: "UST3M", date: "2026-10-16", value: 0.0392 }, { code: "UST10Y", date: "2026-10-16", value: 0.0418 }]);
  });
  it("CoinGecko market_chart keeps one point per day", () => {
    const r = parseCoinGeckoChart({ prices: [[Date.UTC(2026, 9, 15), 100], [Date.UTC(2026, 9, 16), 101], [Date.UTC(2026, 9, 16, 12), 102]] });
    expect(r).toEqual([{ date: "2026-10-15", close: 100 }, { date: "2026-10-16", close: 102 }]);
  });
  it("Alpha Vantage, including rate-limit notes as errors", () => {
    expect(parseAlphaVantage({ "Time Series (Daily)": { "2026-10-16": { "4. close": "520.1" }, "2026-10-15": { "4. close": "518" } } })).toEqual([{ date: "2026-10-15", close: 518 }, { date: "2026-10-16", close: 520.1 }]);
    expect(() => parseAlphaVantage({ Note: "rate limit" })).toThrow(/rate limit/);
  });
  it("brapi", () => {
    expect(parseBrapi({ results: [{ historicalDataPrice: [{ date: 1792108800, close: 130.5 }, { date: 1792195200, close: null }] }] })).toHaveLength(1);
  });
});

describe("CSV import", () => {
  it("parses symbols and ids, reports errors per line", () => {
    const ok = parsePositionsCsv("ativo,quantidade,preco_medio,data_aquisicao\nBOVA11;100;125,5;2025-06-10\nUS-VOO,5,480,2025-03-02");
    expect(ok.errors).toEqual([]);
    expect(ok.rows).toEqual([{ assetId: "BR-BOVA11", quantity: 100, avgPrice: 125.5, acquiredAt: "2025-06-10" }, { assetId: "US-VOO", quantity: 5, avgPrice: 480, acquiredAt: "2025-03-02" }]);
    const bad = parsePositionsCsv("XYZ,1,1,2025-01-01\nBOVA11,-1,1,2025-01-01\nBOVA11,1,1,01/01/2025");
    expect(bad.errors).toHaveLength(3);
  });
});
