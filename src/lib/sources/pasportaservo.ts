import type { NormalizedListing, SourceAdapter } from "./types";

/** One place from Pasporta Servo's public map layer (see scripts/scrapers/pasportaservo.node.ts). */
type PasportaServoRaw = {
  id: string;
  url: string;
  ownerName: string | null;
  ownerAvatar: string | null;
  lat: number;
  lng: number;
};

export const pasportaServo: SourceAdapter = {
  sourceId: "pasportaservo",

  normalize(input) {
    const p = input as PasportaServoRaw;
    if (!p?.id) return null;

    const listing: NormalizedListing = {
      externalId: p.id,
      externalUrl: p.url,
      type: "couch",
      title: p.ownerName ? `Esperanto host: ${p.ownerName}` : "Esperanto host",
      description:
        "Pasporta Servo hosts Esperanto speakers for free. Details are visible to members on Pasporta Servo.",
      guestExpectations: "Guests must speak Esperanto.",
      houseRules: null,
      neighborhood: null,
      city: null,
      subregion: null,
      region: null,
      countryCode: "US",
      // The public layer rounds coordinates to 0.01° (~1 km).
      lat: p.lat,
      lng: p.lng,
      locationPrecision: "approximate",
      maxGuests: null,
      minNights: null,
      maxNights: null,
      priceModel: "free",
      priceAmountCents: null,
      currency: null,
      amenities: [],
      languages: ["Esperanto"],
      rating: null,
      attributes: { requiresEsperanto: true, membershipRequired: true },
      host: {
        externalId: p.id,
        displayName: p.ownerName,
        avatarUrl: p.ownerAvatar,
        profileUrl: p.url,
        languages: ["Esperanto"],
      },
      photos: [],
      availability: [],
      raw: p,
    };
    return listing;
  },
};

export default pasportaServo;
