import { notFound } from "next/navigation";
import { SCREENS, type Screen } from "../fixtures";
import { DesignScreen } from "../screens";

// A dev-only route: blocking on the server is fine, so it skips the instant-navigation shell.
export const instant = false;

export function generateStaticParams() {
  return SCREENS.map((screen) => ({ screen }));
}

/** Development only: each design screen with sample data, while the backend for it is built. */
export default async function DesignScreenPage({ params }: PageProps<"/dev/screens/[screen]">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { screen } = await params;
  if (!SCREENS.includes(screen as Screen)) notFound();
  return <DesignScreen screen={screen as Screen} />;
}
