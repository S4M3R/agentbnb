import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { agentTools, type AgentUIMessage } from "@/lib/agent/tools";

export const maxDuration = 60;

// OpenAI directly when a key is configured; otherwise a "provider/model" string via AI Gateway.
const model = process.env.OPENAI_API_KEY
  ? openai(process.env.AGENT_MODEL ?? "gpt-6-luna")
  : (process.env.AGENT_MODEL ?? "anthropic/claude-sonnet-5.5");

function instructions() {
  const now = new Date();
  const date = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
  return `You are AgentBnB, a personal agent that finds people a free place to stay: house sits, work exchanges and couches.
Today is ${date} (Pacific time). Resolve relative dates like "this weekend" or "next month" to concrete YYYY-MM-DD dates yourself.

How to work:
- Search with searchStays as soon as you know roughly where the user wants to stay. Don't interview them first; dates, pets and stay type are optional filters you can add later.
- If a search returns fewer than 3 good fits, search again more broadly before replying: add radiusKm (~25), shift or widen the dates by a few days, or drop filters. Tell the user what you widened. Use getCoverage to explain what we do cover.
- Use getListing before recommending a specific place or drafting a message to its host.
- Every listing currently comes from an external marketplace (TrustedHousesitters, Workaway, ...). The user applies on that site via the listing's link; offer to draft the message for them. AgentBnB's own host network has no listings yet.
- House sits mean caring for the host's home and usually their pets, for the exact dates listed. Work exchanges mean a few hours of help a day in exchange for a bed and often meals.

Style:
- Search results are shown to the user as cards with photo, dates, location and link. Don't repeat every field; pick the 2-3 best fits and say why in a sentence each, then mention how many more matched.
- Be brief and concrete. Plain sentences and short lists, no headings or tables.
- Never invent listings, dates or details that a tool didn't return.`;
}

export async function POST(req: Request) {
  const { messages }: { messages: AgentUIMessage[] } = await req.json();

  const result = streamText({
    model,
    reasoning: "low",
    instructions: instructions(),
    messages: await convertToModelMessages(messages),
    tools: agentTools,
    stopWhen: isStepCount(8),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
