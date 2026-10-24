import { apiError } from "@/lib/api-auth";
import { reverseGeocode, searchPlaces, shortLabel, type Place } from "@/lib/geocode";

// Backs the location picker in the chat: `?q=` searches places, `?lat=&lng=` names a point.
// Proxied (not called from the browser) so every Nominatim request carries our User-Agent.

function view(p: Place) {
  return { lat: p.lat, lng: p.lng, label: p.label, short: shortLabel(p) };
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim();
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  try {
    if (q) return Response.json({ places: (await searchPlaces(q.slice(0, 200))).map(view) });
    if (params.has("lat") && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      const place = await reverseGeocode(lat, lng);
      return Response.json({ places: place ? [view(place)] : [] });
    }
    return apiError(400, "INVALID_QUERY", "Pass ?q= or ?lat=&lng=.");
  } catch {
    return apiError(502, "GEOCODER_UNAVAILABLE", "Couldn't look that up right now.");
  }
}
