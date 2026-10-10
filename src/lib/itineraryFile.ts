import { airlineName } from "@engine/airlines.ts";
import type { Booking } from "@engine/types.ts";
import { duration, money } from "./format";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Build a self-contained, printable HTML itinerary for download. */
export function itineraryHtml(b: Booking): string {
  const demo = b.mode === "demo";
  const slices = b.itineraryDetails.slices
    .map(
      (s, i) => `
      <h3>${i === 0 ? "Outbound" : "Return"} · ${esc(s.origin)} → ${esc(s.destination)} · ${duration(s.durationMinutes)}</h3>
      <table>
        <tr><th>Flight</th><th>From</th><th>Departs (local)</th><th>To</th><th>Arrives (local)</th><th>Cabin</th></tr>
        ${s.segments
          .map(
            (g) =>
              `<tr><td>${esc(g.flightNumber)}<br><small>${esc(airlineName(g.marketingCarrier))}</small></td><td>${esc(g.origin)}</td><td>${esc(g.departureAt.replace("T", " ").slice(0, 16))}</td><td>${esc(g.destination)}</td><td>${esc(g.arrivalAt.replace("T", " ").slice(0, 16))}</td><td>${esc(g.cabin.replace("_", " "))}</td></tr>`,
          )
          .join("")}
      </table>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${demo ? "DEMO " : ""}Itinerary ${esc(b.airlineBookingReference)}</title>
<style>body{font-family:Inter,system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 16px;color:#0b1324}
h1{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:8px 0 20px;font-size:14px}th,td{border-bottom:1px solid #e3e7ee;padding:8px;text-align:left;vertical-align:top}
th{font-size:12px;color:#5b6474}.demo{background:#f3edff;border:2px dashed #7c3aed;color:#4c1d95;padding:12px 16px;border-radius:10px;font-weight:600;margin:16px 0}
.kv{display:grid;grid-template-columns:200px 1fr;gap:6px 12px;font-size:14px}.kv div:nth-child(odd){color:#5b6474}</style></head><body>
${demo ? '<div class="demo">DEMO — SIMULATED BOOKING. This is not a real reservation or ticket and cannot be used for travel.</div>' : ""}
<h1>FareBuddy itinerary</h1><p>Booking reference <strong>${esc(b.airlineBookingReference)}</strong></p>
<div class="kv">
<div>Provider reference</div><div>${esc(b.providerBookingReference)}</div>
<div>Passengers</div><div>${b.passengerNames.map(esc).join(", ")}</div>
<div>Total paid</div><div>${esc(money(b.totalPaid, b.currency, { decimals: true }))}</div>
<div>Payment method</div><div>${esc(b.paymentSummary.label)}</div>
<div>Booking status</div><div>${esc(b.bookingStatus)}</div>
<div>Ticketing status</div><div>${esc(b.ticketingStatus)}${b.ticketNumbers.length ? ` — ${b.ticketNumbers.map(esc).join(", ")}` : ""}</div>
<div>Confirmed</div><div>${esc(new Date(b.providerConfirmation.confirmedAt).toUTCString())}</div>
</div>${slices}
<p style="font-size:12px;color:#5b6474">${esc(b.providerConfirmation.message)}</p></body></html>`;
}

export function downloadItinerary(b: Booking) {
  const blob = new Blob([itineraryHtml(b)], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${b.mode === "demo" ? "DEMO-" : ""}itinerary-${b.airlineBookingReference}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
