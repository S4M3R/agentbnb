import { tool } from "ai";
import { z } from "zod";
import { buildCalendar, focusMonth } from "@/components/calendar/calendar";
import { calendarToday, getCalendar } from "@/lib/calendar";
import type { WebSession } from "@/lib/session";

// The member's calendar in the chat: the card shows the month, the model gets the gist.

export function calendarTools(session: WebSession) {
  return {
    getMyCalendar: tool({
      description:
        "Show the user's calendar as a card: nights booked, requested, open or blocked at their own places, and " +
        "where they sleep on each night of their trips, with gaps (nights between stays with no place) and " +
        "overlaps. Use when they ask what's booked, when their place is free, whether their trip is covered, " +
        "or before suggesting dates.",
      inputSchema: z.object({
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/, "YYYY-MM")
          .optional()
          .describe("Month to open the card on. Defaults to the next month with something on it."),
        side: z
          .enum(["hosting", "trip"])
          .optional()
          .describe("Only their places (hosting) or only their trips. Omit to show both."),
      }),
      execute: async ({ month, side }) => {
        const user = await session.user();
        const data = user
          ? await getCalendar(user.id)
          : buildCalendar({ today: calendarToday(), places: [], guests: [], stays: [] });
        return { data, month: month ?? focusMonth(data, side), side };
      },
      // The card has every bar; the model only needs what's coming up and what's wrong.
      toModelOutput: ({ output: { data } }) => ({
        type: "json",
        value: {
          today: data.today,
          places: data.rows.filter((r) => r.side === "hosting").map((r) => r.label),
          summary: data.summary,
          upcoming: data.items
            .filter((i) => i.end > data.today && i.tone !== "open")
            .sort((a, b) => a.start.localeCompare(b.start))
            .slice(0, 25)
            .map((i) => ({ side: i.side, kind: i.tone, label: i.label, detail: i.detail, from: i.start, until: i.end })),
        },
      }),
    }),
  };
}
