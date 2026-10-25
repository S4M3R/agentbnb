import { notFound } from "next/navigation";
import { ResetBrowser } from "./reset-browser";

export const metadata = { title: "Reset · AgentBnB" };

/** Dev only: wipes this browser's AgentBnB data (chat history, apply list, cached header data) for a clean demo. */
export default function ResetPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ResetBrowser />;
}
