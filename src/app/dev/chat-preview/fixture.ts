import type { AgentUIMessage } from "@/lib/agent/tools";

// Sample conversation for designing the chat UI without a database or model. All listings are made up.

const photo = (id: string) => `https://images.unsplash.com/photo-${id}?w=900&q=70&auto=format&fit=crop`;

const rockridge = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Sunny Craftsman with two senior cats",
  type: "house_sit" as const,
  source: { id: "trustedhousesitters", name: "TrustedHousesitters" },
  url: "https://www.trustedhousesitters.com/",
  location: "Rockridge, Oakland, California",
  distanceKm: null,
  photo: photo("1502672260266-1c1ef2d93688"),
  dates: [{ start: "2026-10-30", end: "2026-11-02" }],
  highlights: ["2 cats", "House"],
  summary: "Two sleepy cats, a garden and a long table for working. Ten minutes to BART.",
  maxGuests: 2,
  rating: null,
};

export const previewMessages: AgentUIMessage[] = [
  {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text: "I just got to Oakland and need a place this weekend" }],
  },
  {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "text", text: "Here's what's open in Oakland from Friday Oct 30 to Sunday Nov 1." },
      {
        type: "tool-searchStays",
        toolCallId: "call-1",
        state: "output-available",
        input: { location: "Oakland", startDate: "2026-10-30", endDate: "2026-11-01", limit: 8 },
        output: {
          total: 14,
          results: [
            rockridge,
            {
              id: "00000000-0000-4000-8000-000000000002",
              title: "Help at our urban garden collective",
              type: "work_exchange",
              source: { id: "workaway", name: "Workaway" },
              url: "https://www.workaway.info/",
              location: "Temescal, Oakland, California",
              distanceKm: null,
              photo: photo("1493809842364-78817add7ffb"),
              dates: [{ start: "2026-10-28", end: "2026-11-15" }],
              highlights: ["min stay: 1 week", "Gardening"],
              summary: null,
              maxGuests: 1,
              rating: 4.91,
            },
            {
              id: "00000000-0000-4000-8000-000000000003",
              title: "Hillside cottage with a very good dog",
              type: "house_sit",
              source: { id: "trustedhousesitters", name: "TrustedHousesitters" },
              url: "https://www.trustedhousesitters.com/",
              location: "Montclair, Oakland, California",
              distanceKm: null,
              photo: photo("1595526114035-0d45ed16cfbf"),
              dates: [{ start: "2026-10-31", end: "2026-11-04" }],
              highlights: ["1 dog", "Cottage"],
              summary: null,
              maxGuests: 2,
              rating: null,
            },
            {
              id: "00000000-0000-4000-8000-000000000004",
              title: "Two retrievers and a big garden",
              type: "house_sit",
              source: { id: "housecarers", name: "HouseCarers" },
              url: "https://www.housecarers.com/",
              location: "Piedmont, California",
              distanceKm: null,
              photo: photo("1554995207-c18c203602cb"),
              dates: [{ start: "2026-10-30", end: "2026-11-08" }],
              highlights: ["2 dogs", "family friendly"],
              summary: null,
              maxGuests: 3,
              rating: null,
            },
          ],
        },
      },
      {
        type: "text",
        text: "Best fit: **Sunny Craftsman in Rockridge**, a cat sit that matches your dates exactly. The **Montclair cottage** starts a day later, and the **garden collective** works if you can stay a week. 10 more matched.",
      },
    ],
  },
  {
    id: "u2",
    role: "user",
    parts: [{ type: "text", text: 'Tell me more about "Sunny Craftsman with two senior cats"' }],
  },
  {
    id: "a2",
    role: "assistant",
    parts: [
      {
        type: "tool-getListing",
        toolCallId: "call-2",
        state: "output-available",
        input: { id: rockridge.id },
        output: {
          id: rockridge.id,
          title: rockridge.title,
          type: rockridge.type,
          source: rockridge.source,
          url: rockridge.url,
          location: rockridge.location,
          locationPrecision: "neighborhood",
          photos: [
            rockridge.photo,
            photo("1484154218962-a197022b5858"),
            photo("1617806118233-18e1de247200"),
            photo("1505693416388-ac5ce068fe85"),
            photo("1586023492125-27b2c045efd7"),
          ],
          dates: [
            { start: "2026-10-30", end: "2026-11-02", details: {} },
            { start: "2026-12-18", end: "2026-12-27", details: {} },
          ],
          highlights: ["2 cats", "House", "Wi-Fi and a desk", "Garden"],
          description: rockridge.summary,
          guestExpectations: "Feed Miso and Pepper twice a day and water the tomatoes.",
          houseRules: null,
          maxGuests: 2,
          minNights: 3,
          maxNights: null,
          price: { model: "free", amountCents: null, currency: null },
          amenities: [],
          languages: ["English"],
          attributes: {},
          rating: null,
          host: {
            name: "Dana",
            profileUrl: null,
            avatarUrl: photo("1438761681033-6461ffad8d80"),
            references: 12,
            rating: 4.95,
            memberSince: null,
          },
          lastSeenAt: null,
        },
      },
      {
        type: "text",
        text: "Dana needs someone Friday to Monday to feed Miso and Pepper and water the tomatoes. You'd apply on TrustedHousesitters; want me to draft the message?",
      },
    ],
  },
];

/** `?login=1`: the agent asking for a Workaway login with the inline askForLogin card. */
export const loginAskMessages: AgentUIMessage[] = [
  { id: "u-login", role: "user", parts: [{ type: "text", text: "Apply to the garden collective on Workaway for me" }] },
  {
    id: "a-login",
    role: "assistant",
    parts: [
      { type: "text", text: "Workaway wants you logged in to apply. Save your login here and I'll sign in for you." },
      {
        type: "tool-askForLogin",
        toolCallId: "call-login",
        state: "input-available",
        input: {
          site: "workaway",
          siteName: "Workaway",
          reason: "Workaway needs you logged in to send your application.",
        },
      },
    ],
  },
];

/**
 * `?app=<uuid>`: a sent application's card, for one of your own applications (e.g. a test one
 * waiting for your login). Its live status and form come from /api/applications.
 */
export function applicationMessages(id: string): AgentUIMessage[] {
  return [
    { id: "u-app", role: "user", parts: [{ type: "text", text: "Send it" }] },
    {
      id: "a-app",
      role: "assistant",
      parts: [
        {
          type: "tool-sendApplications",
          toolCallId: "call-app",
          state: "output-available",
          input: { applicationIds: [id] },
          output: {
            applications: [
              {
                id,
                status: "sending",
                statusMessage: null,
                title: "Your application",
                source: "Workaway",
                sourceId: "workaway",
                photo: null,
                startDate: null,
                endDate: null,
                intro: null,
                url: `/applications/${id}`,
              },
            ],
          },
        },
      ],
    },
  ];
}
