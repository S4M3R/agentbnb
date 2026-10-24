/** The public origin: `APP_URL` if set, else Vercel's production domain, else local dev. */
export const SITE_URL =
  process.env.APP_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const SITE_NAME = "AgentBnB";
export const SITE_TAGLINE = "Your personal agent for finding a couch, anywhere";
export const SITE_DESCRIPTION =
  "Tell AgentBnB where you're headed and it searches Couchsurfing, BeWelcome, Trustroots, house sits, work exchanges and its own network of hosts at once, then asks hosts for you. Or put your own place up in one sentence.";
