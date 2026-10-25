import { tool } from "ai";
import { z } from "zod";

// Asking for a login on another site inside the web chat.
//
// Client-side tool (no execute): the chat shows a secure card (src/app/login-ask.tsx) with the
// site, a login field prefilled with their saved Keychain login for the site or their profile email,
// a password field (with "Generate a secure password") and "Save and continue". The card saves the
// login straight to the Keychain with a server action; the browser answers the tool with
// addToolOutput and only ever passes { saved, site, login } (or the person's other choice). The
// password never reaches the tool output, the model, the chat's messages or its saved history.

const Output = z.discriminatedUnion("saved", [
  z.object({
    saved: z.literal(true),
    site: z.string().describe("The Keychain site the login was saved for."),
    login: z.string().describe("The email or username they log in with. Not secret."),
  }),
  z.object({
    saved: z.literal(false),
    site: z.string(),
    choice: z.enum(["browser", "not_now"]).describe("browser: they'll log in themselves in the agent's browser."),
  }),
]);

export type LoginAskOutput = z.infer<typeof Output>;

export const askForLogin = tool({
  description:
    "Ask the person for their login on another site (Couchsurfing, Workaway, ...) inside the chat. They see a secure " +
    "card with the site, their login prefilled (their saved login there, or their profile email) and a password field " +
    "(they can also generate a strong one); it's encrypted into their Keychain and you never see the password. Use it " +
    "when a site needs their account: an application waiting for their login, or they want their agent to sign in for " +
    "them somewhere. Returns saved with the site and login (waiting applications for that site continue on their own), " +
    "or that they'll log in themselves in the browser, or not now.",
  inputSchema: z.object({
    site: z
      .string()
      .min(1)
      .max(300)
      .describe('The source id from a listing or application (e.g. "workaway"), or the site\'s domain (e.g. "example.com").'),
    siteName: z.string().min(1).max(80).describe('How the site is called, e.g. "Workaway".'),
    reason: z
      .string()
      .max(200)
      .describe('One friendly line on why, shown on the card, e.g. "Workaway needs you logged in to send your application."'),
  }),
  outputSchema: Output,
  // Only the whitelisted fields reach the model, whatever else a client might send.
  toModelOutput: ({ output }) => {
    const value: Record<string, string | boolean> = output.saved
      ? { saved: true, site: String(output.site), login: String(output.login) }
      : { saved: false, site: String(output.site), choice: output.choice === "browser" ? "browser" : "not_now" };
    return { type: "json", value };
  },
});
