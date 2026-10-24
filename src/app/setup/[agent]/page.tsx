import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CONNECTABLE_AGENTS } from "@/lib/connect-agent";
import { findConnectableAgent } from "@/lib/setup-guide";
import { SetupPage, setupMetadata } from "../guide";

// /setup/<agent id>: the guide tailored to one of the home banner's agents (CONNECTABLE_AGENTS),
// which is what its copied prompt points at. Prerendered for each of them; other ids are a 404.

// A document, not app UI: the steps must be in the HTML itself (agents read it as text), so the page
// awaits params up front instead of streaming them behind a Suspense fallback. Navigations here may
// block on that; every real id is prerendered anyway.
export const instant = false;

export function generateStaticParams() {
  return CONNECTABLE_AGENTS.map((a) => ({ agent: a.id }));
}

export async function generateMetadata({ params }: PageProps<"/setup/[agent]">): Promise<Metadata> {
  const agent = findConnectableAgent((await params).agent);
  if (!agent) notFound();
  return setupMetadata(agent);
}

export default async function AgentSetupPage({ params }: PageProps<"/setup/[agent]">) {
  const agent = findConnectableAgent((await params).agent);
  if (!agent) notFound();
  return <SetupPage agent={agent} />;
}
