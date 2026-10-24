import { CONNECTABLE_AGENTS, setupPath, type ConnectableAgent } from "@/lib/connect-agent";

// The setup guide a personal agent follows to connect its person to AgentBnB, as data. One source
// for both readers: /setup/<agent id> renders it as HTML (src/app/setup/guide.tsx), and /setup.md
// (plus /setup/<agent id> asked for as Markdown, see src/proxy.ts) serves it as Markdown.
// Without an agent it's the generic version, with the table of agent kinds.
//
// Text in blocks is Markdown inline: **bold** and `code`. URLs are linked in the HTML.

export type GuideBlock =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; lang: string; code: string }
  | { type: "table"; head: string[]; rows: string[][] };

export type GuideStep = { title: string; blocks: GuideBlock[] };

export type SetupGuide = {
  agent: ConnectableAgent | undefined;
  title: string;
  intro: GuideBlock[];
  steps: GuideStep[];
};

export function findConnectableAgent(id: string | null | undefined) {
  return CONNECTABLE_AGENTS.find((a) => a.id === id);
}

const agentLabel = (a: ConnectableAgent) => (a.maker === a.name ? a.name : `${a.name} (${a.maker})`);

export function setupGuide(base: string, agent: ConnectableAgent | undefined): SetupGuide {
  const agentJson = agent ? JSON.stringify(agent.register) : `{ "kind": "<see the table>" }`;
  const who = agent ? agent.name : "you";

  return {
    agent,
    title: "Set up AgentBnB",
    intro: [
      {
        type: "p",
        text: "You're a personal agent, and your person wants to use AgentBnB. Follow these steps once, in order. When you're done, you can find them a free place to stay and put their place up for travelers, just by talking to AgentBnB.",
      },
      {
        type: "p",
        text: "**What AgentBnB is:** a network for finding a free place to crash (couches, spare rooms, house sits, work exchanges) and for hosting travelers. It searches the big marketplaces (TrustedHousesitters, Workaway, HomeExchange, ...) plus its own network of members, and it can list your person's place.",
      },
      {
        type: "p",
        text: `Site: ${base}. Full API reference: ${base}/docs.md (read it if a step below isn't enough). This guide: ${base}${setupPath(agent)}.`,
      },
    ],
    steps: [
      {
        title: "Ask your person for two things",
        blocks: [
          {
            type: "list",
            items: ["Their **name**, as hosts should see it.", "Their **email**. It's their AgentBnB identity and stays private."],
          },
          {
            type: "p",
            text: "Optional, and worth asking in the same message: their **home city**, the **languages** they speak, and one or two lines **about them** (what they do, why they travel). Hosts read these before saying yes.",
          },
          { type: "p", text: "If you already know these from earlier conversations, confirm them instead of asking again." },
        ],
      },
      {
        title: "Register them",
        blocks: [
          {
            type: "code",
            lang: "bash",
            code: `curl -X POST ${base}/api/v1/register \\
  -H 'content-type: application/json' \\
  -d '{
    "person": { "name": "<name>", "email": "<email>", "homeCity": "<city, optional>", "bio": "<optional>" },
    "agent": ${agentJson}
  }'`,
          },
          ...(agent
            ? []
            : ([
                { type: "p", text: "Use the `agent` value for whoever you are:" },
                {
                  type: "table",
                  head: ["Agent", "`agent`"],
                  rows: [
                    ...CONNECTABLE_AGENTS.map((a) => [agentLabel(a), `\`${JSON.stringify(a.register)}\``]),
                    ["Any other agent", '`{"kind":"other","name":"<your name>"}`'],
                  ],
                },
              ] satisfies GuideBlock[])),
          { type: "p", text: "The response (201) has `apiKey` (starts with `abnb_`) and `user.id`." },
          {
            type: "list",
            items: [
              "**`EMAIL_TAKEN` (409):** they're already a member. Tell them, and ask them to give you an API key from their existing setup (any key can create more with `POST /api/v1/keys`). Don't register a second account.",
              "**`INVALID_BODY` (400):** `error.message` names the field; fix it and retry.",
            ],
          },
        ],
      },
      {
        title: "Keep the key secret",
        blocks: [
          {
            type: "p",
            text: `Save \`apiKey\` where ${who} keep${agent ? "s" : ""} credentials. ${agent?.keyNote ?? "Use your secret store or vault."} It's shown only once. Never paste it into a chat, a message to your person, or a file someone else can read. Send it as \`Authorization: Bearer <apiKey>\` on every call below.`,
          },
        ],
      },
      {
        title: "Fill in their profile",
        blocks: [
          {
            type: "p",
            text: "If you learned their languages or anything else in step 1, save it now. Hosts see this profile when your person asks to stay.",
          },
          {
            type: "code",
            lang: "bash",
            code: `curl -X PATCH ${base}/api/v1/me \\
  -H 'authorization: Bearer <apiKey>' -H 'content-type: application/json' \\
  -d '{ "homeCity": "Buenos Aires", "languages": ["Spanish", "English"], "bio": "Product designer. Travels for work and surf." }'`,
          },
          { type: "p", text: `Their public profile is at \`${base}/people/<user.id>\`.` },
        ],
      },
      {
        title: "Talk to AgentBnB",
        blocks: [
          {
            type: "p",
            text: `From now on, when your person needs a place to stay or wants to host, message AgentBnB over A2A (JSON-RPC at \`${base}/a2a\`, agent card at \`${base}/.well-known/agent-card.json\`) with the key above. Write the way your person would:`,
          },
          {
            type: "code",
            lang: "bash",
            code: `curl ${base}/a2a -H 'content-type: application/json' -H 'A2A-Version: 1.0' \\
  -H 'authorization: Bearer <apiKey>' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "SendMessage",
  "params": { "message": { "messageId": "m1", "role": "ROLE_USER",
    "parts": [{ "text": "I land in Oakland on Friday and need a couch for two nights." }] } }
}'`,
          },
          {
            type: "list",
            items: [
              "The reply (`result.task.status.message`) is short and written for your person. Relay it, links included.",
              "Keep the conversation going by sending the task's `contextId` with the next message.",
              'To host: "Put my place up this weekend", and attach photos of the place as image parts.',
              "Searching works without a key; hosting and anything about their account needs it.",
            ],
          },
        ],
      },
      {
        title: "Tell your person you're connected",
        blocks: [
          {
            type: "p",
            text: 'Say it in one or two sentences, with the link to their public profile, and suggest a first thing to try, like "Want me to find you somewhere to stay on your next trip?" Don\'t show them the API key.',
          },
        ],
      },
    ],
  };
}

function blockMarkdown(block: GuideBlock) {
  switch (block.type) {
    case "p":
      return block.text;
    case "list":
      return block.items.map((item) => `- ${item}`).join("\n");
    case "code":
      return `\`\`\`${block.lang}\n${block.code}\n\`\`\``;
    case "table":
      return [block.head, block.head.map(() => "---"), ...block.rows].map((row) => `| ${row.join(" | ")} |`).join("\n");
  }
}

/** The guide as Markdown, for /setup.md and agents that ask /setup/<id> for text/markdown. */
export function setupMarkdown(base: string, agent: ConnectableAgent | undefined) {
  const guide = setupGuide(base, agent);
  const sections = [
    `# ${guide.title}`,
    ...guide.intro.map(blockMarkdown),
    ...guide.steps.flatMap((step, i) => [`## ${i + 1}. ${step.title}`, ...step.blocks.map(blockMarkdown)]),
  ];
  return `${sections.join("\n\n")}\n`;
}
