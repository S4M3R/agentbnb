import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    // Check external sites for host replies and nudge quiet applications. Daily is the Hobby
    // plan's limit; on Pro, run it every 15 minutes ("*/15 * * * *").
    { path: "/api/cron/applications", schedule: "0 15 * * *" },
  ],
};
