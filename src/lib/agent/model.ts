import { openai } from "@ai-sdk/openai";

// OpenAI directly when a key is configured; otherwise a "provider/model" string via AI Gateway.
export const agentModel = process.env.OPENAI_API_KEY
  ? openai(process.env.AGENT_MODEL ?? "gpt-6-luna")
  : (process.env.AGENT_MODEL ?? "anthropic/claude-sonnet-5.5");
