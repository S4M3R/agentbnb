// A2A agent card: how other agents (Instinct, ...) discover AgentBnB and what it can do.
// Written for A2A 1.0 (`supportedInterfaces`), with the 0.3 fields (`url`, `preferredTransport`,
// `protocolVersion`, `security`) alongside so older SDKs can connect too.

const KEY_SCHEME = "agentbnbKey";

export function agentCard(origin: string) {
  const endpoint = `${origin}/a2a`;
  const needsKey = {
    securityRequirements: [{ schemes: { [KEY_SCHEME]: { list: [] } } }],
    security: [{ [KEY_SCHEME]: [] }],
  };
  return {
    name: "AgentBnB",
    description:
      "Finds a free place to crash (couches, spare rooms, house sits, work exchanges) across every marketplace " +
      "plus AgentBnB's own hosts, and lists your own place. Talk to it in plain language. Replies are short, plain " +
      "text meant to be relayed to the person, ending with a link (https://.../s/<id>) to the picks. Send that " +
      "link as its own iMessage: it unfolds into a preview card with photos.",
    supportedInterfaces: [
      { url: endpoint, protocolBinding: "JSONRPC", protocolVersion: "1.0" },
      { url: endpoint, protocolBinding: "JSONRPC", protocolVersion: "0.3" },
    ],
    provider: { organization: "AgentBnB", url: origin },
    version: "1.0.0",
    documentationUrl: `${origin}/docs.md`,
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    securitySchemes: {
      [KEY_SCHEME]: {
        httpAuthSecurityScheme: {
          scheme: "Bearer",
          description: "An AgentBnB API key (abnb_...). Get one with POST /api/v1/register; see /docs.md.",
        },
        // 0.3 (OpenAPI-style) shape of the same scheme.
        type: "http",
        scheme: "bearer",
        description: "An AgentBnB API key (abnb_...). Optional for searching, required for hosting.",
      },
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "find-stay",
        name: "Find a place to stay",
        description:
          "Searches couches, spare rooms, house sits and work exchanges on external marketplaces and AgentBnB's own " +
          "network, and replies with the best picks on one link. No API key needed.",
        tags: ["travel", "lodging", "couchsurfing", "house-sitting", "work-exchange"],
        examples: [
          "I just got to Oakland and need a couch tonight",
          "Any cat sits in San Francisco in December?",
          "Find me a farm work exchange in California for two weeks in March",
        ],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"],
      },
      {
        id: "host-my-place",
        name: "List my place",
        description:
          "Writes and publishes a listing for the person's couch or spare room on AgentBnB from a sentence, an " +
          "address and a few photos (attach them as image parts). Needs the person's API key.",
        tags: ["hosting", "listing"],
        examples: ["Put my place up for this weekend", "Publish it", "Add these photos to my listing"],
        inputModes: ["text/plain", "image/jpeg", "image/png", "image/webp", "image/heic"],
        outputModes: ["text/plain", "application/json"],
        ...needsKey,
      },
    ],
    // A2A 0.3
    protocolVersion: "0.3.0",
    url: endpoint,
    preferredTransport: "JSONRPC",
  };
}

export function GET(req: Request) {
  return Response.json(agentCard(new URL(req.url).origin), {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
