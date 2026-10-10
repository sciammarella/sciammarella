export interface Airline {
  code: string;
  name: string;
  hubs: string[];
  /** Domestic carriers connect every airport in their country to their hubs. */
  domesticCountry?: string;
  /** Relative price level (1 = market average). */
  priceLevel: number;
  /** Checked bags included in the standard economy fare. */
  standardBags: number;
  longHaulAircraft: string[];
  shortHaulAircraft: string[];
}

export const AIRLINES: Airline[] = [
  { code: "LA", name: "LATAM Airlines", hubs: ["GRU", "SCL", "LIM", "BOG"], domesticCountry: "BR", priceLevel: 1.0, standardBags: 1, longHaulAircraft: ["Boeing 787-9", "Boeing 777-300ER"], shortHaulAircraft: ["Airbus A320neo", "Airbus A321"] },
  { code: "G3", name: "GOL Linhas Aéreas", hubs: ["GRU", "CGH", "GIG", "BSB"], domesticCountry: "BR", priceLevel: 0.92, standardBags: 0, longHaulAircraft: ["Boeing 737 MAX 8"], shortHaulAircraft: ["Boeing 737-800", "Boeing 737 MAX 8"] },
  { code: "AD", name: "Azul", hubs: ["VCP", "CNF"], domesticCountry: "BR", priceLevel: 0.95, standardBags: 0, longHaulAircraft: ["Airbus A330-900neo"], shortHaulAircraft: ["Embraer E195-E2", "Airbus A320neo"] },
  { code: "QR", name: "Qatar Airways", hubs: ["DOH"], priceLevel: 1.08, standardBags: 2, longHaulAircraft: ["Boeing 777-300ER", "Airbus A350-1000"], shortHaulAircraft: ["Airbus A320"] },
  { code: "EK", name: "Emirates", hubs: ["DXB"], priceLevel: 1.06, standardBags: 2, longHaulAircraft: ["Airbus A380-800", "Boeing 777-300ER"], shortHaulAircraft: ["Boeing 777-300ER"] },
  { code: "EY", name: "Etihad Airways", hubs: ["AUH"], priceLevel: 1.02, standardBags: 2, longHaulAircraft: ["Boeing 787-10", "Airbus A350-1000"], shortHaulAircraft: ["Airbus A321"] },
  { code: "TK", name: "Turkish Airlines", hubs: ["IST"], priceLevel: 0.96, standardBags: 2, longHaulAircraft: ["Boeing 777-300ER", "Airbus A350-900"], shortHaulAircraft: ["Airbus A321neo"] },
  { code: "LH", name: "Lufthansa", hubs: ["FRA", "MUC"], priceLevel: 1.1, standardBags: 1, longHaulAircraft: ["Boeing 747-8", "Airbus A350-900"], shortHaulAircraft: ["Airbus A320neo"] },
  { code: "AF", name: "Air France", hubs: ["CDG"], priceLevel: 1.07, standardBags: 1, longHaulAircraft: ["Boeing 777-300ER", "Airbus A350-900"], shortHaulAircraft: ["Airbus A220-300"] },
  { code: "KL", name: "KLM", hubs: ["AMS"], priceLevel: 1.05, standardBags: 1, longHaulAircraft: ["Boeing 787-10", "Boeing 777-300ER"], shortHaulAircraft: ["Embraer E195-E2"] },
  { code: "BA", name: "British Airways", hubs: ["LHR"], priceLevel: 1.12, standardBags: 1, longHaulAircraft: ["Boeing 787-9", "Airbus A350-1000"], shortHaulAircraft: ["Airbus A320neo"] },
  { code: "IB", name: "Iberia", hubs: ["MAD"], priceLevel: 0.98, standardBags: 1, longHaulAircraft: ["Airbus A350-900", "Airbus A330-200"], shortHaulAircraft: ["Airbus A321XLR"] },
  { code: "TP", name: "TAP Air Portugal", hubs: ["LIS"], priceLevel: 0.94, standardBags: 1, longHaulAircraft: ["Airbus A330-900neo"], shortHaulAircraft: ["Airbus A321LR"] },
  { code: "LX", name: "SWISS", hubs: ["ZRH"], priceLevel: 1.14, standardBags: 1, longHaulAircraft: ["Boeing 777-300ER"], shortHaulAircraft: ["Airbus A220-300"] },
  { code: "AA", name: "American Airlines", hubs: ["DFW", "MIA", "JFK", "ORD"], priceLevel: 1.0, standardBags: 1, longHaulAircraft: ["Boeing 787-9", "Boeing 777-300ER"], shortHaulAircraft: ["Airbus A321neo"] },
  { code: "UA", name: "United Airlines", hubs: ["ORD", "EWR", "IAH", "SFO"], priceLevel: 1.0, standardBags: 1, longHaulAircraft: ["Boeing 787-10", "Boeing 777-300ER"], shortHaulAircraft: ["Boeing 737 MAX 9"] },
  { code: "DL", name: "Delta Air Lines", hubs: ["ATL", "JFK", "LAX", "SEA"], priceLevel: 1.03, standardBags: 1, longHaulAircraft: ["Airbus A350-900", "Airbus A330-900neo"], shortHaulAircraft: ["Airbus A321neo"] },
  { code: "AC", name: "Air Canada", hubs: ["YYZ"], priceLevel: 1.02, standardBags: 1, longHaulAircraft: ["Boeing 787-9"], shortHaulAircraft: ["Airbus A220-300"] },
  { code: "CM", name: "Copa Airlines", hubs: ["PTY"], priceLevel: 0.95, standardBags: 1, longHaulAircraft: ["Boeing 737 MAX 9"], shortHaulAircraft: ["Boeing 737-800"] },
  { code: "AM", name: "Aeroméxico", hubs: ["MEX"], priceLevel: 0.97, standardBags: 1, longHaulAircraft: ["Boeing 787-9"], shortHaulAircraft: ["Boeing 737 MAX 8"] },
  { code: "ET", name: "Ethiopian Airlines", hubs: ["ADD"], priceLevel: 0.9, standardBags: 2, longHaulAircraft: ["Airbus A350-900", "Boeing 787-9"], shortHaulAircraft: ["Boeing 737 MAX 8"] },
  { code: "NH", name: "ANA", hubs: ["HND", "NRT"], domesticCountry: "JP", priceLevel: 1.08, standardBags: 2, longHaulAircraft: ["Boeing 777-300ER", "Boeing 787-9"], shortHaulAircraft: ["Boeing 787-8", "Airbus A321neo"] },
  { code: "JL", name: "Japan Airlines", hubs: ["HND", "NRT"], domesticCountry: "JP", priceLevel: 1.07, standardBags: 2, longHaulAircraft: ["Airbus A350-1000", "Boeing 777-300ER"], shortHaulAircraft: ["Boeing 737-800", "Airbus A350-900"] },
  { code: "SQ", name: "Singapore Airlines", hubs: ["SIN"], priceLevel: 1.12, standardBags: 2, longHaulAircraft: ["Airbus A350-900ULR", "Boeing 777-300ER"], shortHaulAircraft: ["Boeing 737 MAX 8"] },
  { code: "CX", name: "Cathay Pacific", hubs: ["HKG"], priceLevel: 1.06, standardBags: 2, longHaulAircraft: ["Airbus A350-1000", "Boeing 777-300ER"], shortHaulAircraft: ["Airbus A321neo"] },
  { code: "KE", name: "Korean Air", hubs: ["ICN"], priceLevel: 1.02, standardBags: 2, longHaulAircraft: ["Boeing 787-10", "Boeing 777-300ER"], shortHaulAircraft: ["Boeing 737 MAX 8"] },
  { code: "AR", name: "Aerolíneas Argentinas", hubs: ["EZE", "AEP"], domesticCountry: "AR", priceLevel: 0.9, standardBags: 1, longHaulAircraft: ["Airbus A330-200"], shortHaulAircraft: ["Boeing 737 MAX 8"] },
];

const BY_CODE = new Map(AIRLINES.map((a) => [a.code, a]));

export function getAirline(code: string): Airline | undefined {
  return BY_CODE.get(code.toUpperCase());
}

export function airlineName(code: string): string {
  return BY_CODE.get(code.toUpperCase())?.name ?? code;
}
