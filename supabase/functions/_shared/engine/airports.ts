// Reference airport data used for search autocomplete, nearby-airport expansion
// and the demo flight provider. UTC offsets are standard time (DST ignored in demo).

export interface Airport {
  code: string;
  name: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  utcOffset: number;
  /** Metropolitan area code when the city has several airports. */
  metro?: string;
  /** 1 = regional, 2 = international gateway, 3 = global hub. */
  size: 1 | 2 | 3;
}

const A = (
  code: string,
  name: string,
  city: string,
  country: string,
  countryCode: string,
  lat: number,
  lon: number,
  utcOffset: number,
  size: 1 | 2 | 3,
  metro?: string,
): Airport => ({ code, name, city, country, countryCode, lat, lon, utcOffset, size, metro });

export const AIRPORTS: Airport[] = [
  // Brazil
  A("VIX", "Eurico de Aguiar Salles", "Vitória", "Brazil", "BR", -20.258, -40.286, -3, 1),
  A("GRU", "Guarulhos International", "São Paulo", "Brazil", "BR", -23.435, -46.473, -3, 3, "SAO"),
  A("CGH", "Congonhas", "São Paulo", "Brazil", "BR", -23.626, -46.656, -3, 1, "SAO"),
  A("VCP", "Viracopos", "Campinas", "Brazil", "BR", -23.007, -47.134, -3, 2, "SAO"),
  A("GIG", "Galeão International", "Rio de Janeiro", "Brazil", "BR", -22.809, -43.25, -3, 2, "RIO"),
  A("SDU", "Santos Dumont", "Rio de Janeiro", "Brazil", "BR", -22.91, -43.163, -3, 1, "RIO"),
  A("BSB", "Brasília International", "Brasília", "Brazil", "BR", -15.869, -47.92, -3, 2),
  A("CNF", "Confins International", "Belo Horizonte", "Brazil", "BR", -19.624, -43.971, -3, 2),
  A("SSA", "Salvador International", "Salvador", "Brazil", "BR", -12.909, -38.322, -3, 1),
  A("REC", "Guararapes International", "Recife", "Brazil", "BR", -8.126, -34.923, -3, 1),
  A("FOR", "Pinto Martins International", "Fortaleza", "Brazil", "BR", -3.776, -38.533, -3, 1),
  A("POA", "Salgado Filho International", "Porto Alegre", "Brazil", "BR", -29.994, -51.171, -3, 1),
  A("CWB", "Afonso Pena International", "Curitiba", "Brazil", "BR", -25.528, -49.176, -3, 1),
  A("FLN", "Hercílio Luz International", "Florianópolis", "Brazil", "BR", -27.67, -48.548, -3, 1),
  // South & Central America
  A("EZE", "Ministro Pistarini", "Buenos Aires", "Argentina", "AR", -34.822, -58.536, -3, 2, "BUE"),
  A("AEP", "Aeroparque Jorge Newbery", "Buenos Aires", "Argentina", "AR", -34.559, -58.416, -3, 1, "BUE"),
  A("SCL", "Arturo Merino Benítez", "Santiago", "Chile", "CL", -33.393, -70.786, -4, 2),
  A("LIM", "Jorge Chávez International", "Lima", "Peru", "PE", -12.022, -77.114, -5, 2),
  A("BOG", "El Dorado International", "Bogotá", "Colombia", "CO", 4.702, -74.147, -5, 2),
  A("PTY", "Tocumen International", "Panama City", "Panama", "PA", 9.071, -79.383, -5, 2),
  A("MEX", "Benito Juárez International", "Mexico City", "Mexico", "MX", 19.436, -99.072, -6, 2),
  // North America
  A("JFK", "John F. Kennedy International", "New York", "United States", "US", 40.64, -73.779, -5, 3, "NYC"),
  A("EWR", "Newark Liberty International", "New York", "United States", "US", 40.69, -74.174, -5, 3, "NYC"),
  A("LGA", "LaGuardia", "New York", "United States", "US", 40.777, -73.872, -5, 1, "NYC"),
  A("MIA", "Miami International", "Miami", "United States", "US", 25.796, -80.287, -5, 3),
  A("ATL", "Hartsfield–Jackson", "Atlanta", "United States", "US", 33.641, -84.428, -5, 3),
  A("ORD", "O'Hare International", "Chicago", "United States", "US", 41.974, -87.907, -6, 3),
  A("DFW", "Dallas/Fort Worth International", "Dallas", "United States", "US", 32.899, -97.04, -6, 3),
  A("IAH", "George Bush Intercontinental", "Houston", "United States", "US", 29.99, -95.337, -6, 3),
  A("LAX", "Los Angeles International", "Los Angeles", "United States", "US", 33.942, -118.408, -8, 3),
  A("SFO", "San Francisco International", "San Francisco", "United States", "US", 37.621, -122.379, -8, 3),
  A("SEA", "Seattle–Tacoma International", "Seattle", "United States", "US", 47.45, -122.309, -8, 2),
  A("YYZ", "Toronto Pearson", "Toronto", "Canada", "CA", 43.678, -79.625, -5, 3),
  // Europe
  A("LHR", "Heathrow", "London", "United Kingdom", "GB", 51.47, -0.454, 0, 3, "LON"),
  A("LGW", "Gatwick", "London", "United Kingdom", "GB", 51.148, -0.19, 0, 2, "LON"),
  A("CDG", "Charles de Gaulle", "Paris", "France", "FR", 49.01, 2.548, 1, 3, "PAR"),
  A("ORY", "Orly", "Paris", "France", "FR", 48.723, 2.379, 1, 2, "PAR"),
  A("AMS", "Schiphol", "Amsterdam", "Netherlands", "NL", 52.31, 4.768, 1, 3),
  A("FRA", "Frankfurt am Main", "Frankfurt", "Germany", "DE", 50.038, 8.562, 1, 3),
  A("MUC", "Munich", "Munich", "Germany", "DE", 48.354, 11.786, 1, 3),
  A("ZRH", "Zürich", "Zürich", "Switzerland", "CH", 47.458, 8.555, 1, 3),
  A("MAD", "Adolfo Suárez Madrid–Barajas", "Madrid", "Spain", "ES", 40.472, -3.561, 1, 3),
  A("LIS", "Humberto Delgado", "Lisbon", "Portugal", "PT", 38.774, -9.134, 0, 2),
  A("FCO", "Leonardo da Vinci–Fiumicino", "Rome", "Italy", "IT", 41.8, 12.239, 1, 2),
  A("IST", "Istanbul Airport", "Istanbul", "Türkiye", "TR", 41.275, 28.752, 3, 3),
  // Middle East & Africa
  A("DOH", "Hamad International", "Doha", "Qatar", "QA", 25.273, 51.608, 3, 3),
  A("DXB", "Dubai International", "Dubai", "United Arab Emirates", "AE", 25.253, 55.365, 4, 3),
  A("AUH", "Zayed International", "Abu Dhabi", "United Arab Emirates", "AE", 24.433, 54.651, 4, 3),
  A("ADD", "Bole International", "Addis Ababa", "Ethiopia", "ET", 8.978, 38.799, 3, 3),
  A("JNB", "O. R. Tambo International", "Johannesburg", "South Africa", "ZA", -26.139, 28.246, 2, 2),
  // Asia & Pacific
  A("HND", "Haneda", "Tokyo", "Japan", "JP", 35.549, 139.78, 9, 3, "TYO"),
  A("NRT", "Narita International", "Tokyo", "Japan", "JP", 35.772, 140.393, 9, 3, "TYO"),
  A("KIX", "Kansai International", "Osaka", "Japan", "JP", 34.427, 135.244, 9, 2, "OSA"),
  A("ITM", "Itami", "Osaka", "Japan", "JP", 34.785, 135.438, 9, 1, "OSA"),
  A("NGO", "Chubu Centrair", "Nagoya", "Japan", "JP", 34.858, 136.805, 9, 2),
  A("FUK", "Fukuoka", "Fukuoka", "Japan", "JP", 33.586, 130.451, 9, 1),
  A("CTS", "New Chitose", "Sapporo", "Japan", "JP", 42.775, 141.692, 9, 1),
  A("ICN", "Incheon International", "Seoul", "South Korea", "KR", 37.46, 126.441, 9, 3, "SEL"),
  A("PEK", "Beijing Capital", "Beijing", "China", "CN", 40.08, 116.584, 8, 3, "BJS"),
  A("PVG", "Pudong International", "Shanghai", "China", "CN", 31.143, 121.805, 8, 3, "SHA"),
  A("HKG", "Hong Kong International", "Hong Kong", "Hong Kong", "HK", 22.308, 113.918, 8, 3),
  A("TPE", "Taoyuan International", "Taipei", "Taiwan", "TW", 25.078, 121.233, 8, 2),
  A("SIN", "Changi", "Singapore", "Singapore", "SG", 1.364, 103.991, 8, 3),
  A("BKK", "Suvarnabhumi", "Bangkok", "Thailand", "TH", 13.69, 100.75, 7, 3),
  A("DEL", "Indira Gandhi International", "Delhi", "India", "IN", 28.556, 77.1, 5.5, 3),
  A("SYD", "Kingsford Smith", "Sydney", "Australia", "AU", -33.946, 151.177, 10, 3),
];

export const METRO_NAMES: Record<string, { city: string; country: string }> = {
  TYO: { city: "Tokyo", country: "Japan" },
  OSA: { city: "Osaka", country: "Japan" },
  SAO: { city: "São Paulo", country: "Brazil" },
  RIO: { city: "Rio de Janeiro", country: "Brazil" },
  LON: { city: "London", country: "United Kingdom" },
  PAR: { city: "Paris", country: "France" },
  NYC: { city: "New York", country: "United States" },
  BUE: { city: "Buenos Aires", country: "Argentina" },
  SEL: { city: "Seoul", country: "South Korea" },
  BJS: { city: "Beijing", country: "China" },
  SHA: { city: "Shanghai", country: "China" },
};

const BY_CODE = new Map(AIRPORTS.map((a) => [a.code, a]));

export function getAirport(code: string): Airport | undefined {
  return BY_CODE.get(code.toUpperCase());
}

export function isMetroCode(code: string): boolean {
  return code.toUpperCase() in METRO_NAMES;
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: Airport, b: Airport): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const NEARBY_RADIUS_KM = 200;

/**
 * Resolve a place code (airport or metro) into concrete airports.
 * Metro codes always expand to all their airports (the user picked the city).
 * Nearby airports are only added when explicitly allowed.
 */
export function resolvePlace(code: string, includeNearby: boolean): string[] {
  const upper = code.toUpperCase();
  const base = isMetroCode(upper)
    ? AIRPORTS.filter((a) => a.metro === upper).map((a) => a.code)
    : BY_CODE.has(upper)
      ? [upper]
      : [];
  if (!includeNearby) return base;
  const result = new Set(base);
  for (const code of base) {
    const origin = BY_CODE.get(code)!;
    for (const other of AIRPORTS) {
      if (other.metro && origin.metro && other.metro === origin.metro) result.add(other.code);
      if (distanceKm(origin, other) <= NEARBY_RADIUS_KM) result.add(other.code);
    }
  }
  return [...result];
}

export interface PlaceOption {
  code: string;
  label: string;
  sublabel: string;
  kind: "airport" | "metro";
}

export function searchPlaces(query: string, limit = 8): PlaceOption[] {
  const q = query
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  const options: (PlaceOption & { score: number })[] = [];
  for (const [code, m] of Object.entries(METRO_NAMES)) {
    const airports = AIRPORTS.filter((a) => a.metro === code).map((a) => a.code);
    const score = !q ? 1 : code.toLowerCase() === q ? 100 : norm(m.city).startsWith(q) ? 80 : norm(m.city).includes(q) ? 40 : 0;
    if (score > 0)
      options.push({ code, label: `${m.city} (all airports)`, sublabel: `${code} · ${airports.join(", ")} · ${m.country}`, kind: "metro", score: score + 1 });
  }
  for (const a of AIRPORTS) {
    const score = !q
      ? 0
      : a.code.toLowerCase() === q
        ? 100
        : norm(a.city).startsWith(q)
          ? 70
          : norm(a.name).includes(q) || norm(a.country).startsWith(q)
            ? 30
            : 0;
    if (score > 0) options.push({ code: a.code, label: `${a.city} (${a.code})`, sublabel: `${a.name} · ${a.country}`, kind: "airport", score });
  }
  return options.sort((x, y) => y.score - x.score).slice(0, limit).map(({ score: _s, ...o }) => o);
}

export function placeLabel(code: string): string {
  const upper = code.toUpperCase();
  if (isMetroCode(upper)) return `${METRO_NAMES[upper].city} (${upper})`;
  const a = BY_CODE.get(upper);
  return a ? `${a.city} (${a.code})` : upper;
}

export function countryOf(code: string): string | undefined {
  const upper = code.toUpperCase();
  if (isMetroCode(upper)) return AIRPORTS.find((a) => a.metro === upper)?.countryCode;
  return BY_CODE.get(upper)?.countryCode;
}
