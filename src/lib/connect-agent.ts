// The personal agents the home banner offers to connect, and the one-line prompt each one is given.
// The prompt points at /setup/<id>, which walks the agent through registering its person with the
// agent's `kind` (see agentKind in src/db/schema.ts) and talking to AgentBnB over A2A. The guide
// itself is in src/lib/setup-guide.ts.

export type ConnectableAgent = {
  id: string;
  name: string;
  /** Who makes it, shown under the name. */
  maker: string;
  /** App icon under /public/agents. Browsers cache these for a day, so give a changed icon a new file name. */
  icon: string;
  /** The `agent` object for POST /api/v1/register. */
  register: { kind: "instinct" | "dot" | "muse" } | { kind: "other"; name: string };
  /** Where this agent should keep the API key. */
  keyNote?: string;
};

export const CONNECTABLE_AGENTS: ConnectableAgent[] = [
  { id: "instinct", name: "Instinct", maker: "Instinct", icon: "/agents/instinct.png", register: { kind: "instinct" } },
  { id: "muse", name: "Muse", maker: "Meta", icon: "/agents/muse.jpg", register: { kind: "muse" } },
  { id: "dots", name: "Dots", maker: "OpenAI", icon: "/agents/dots-dottie.jpg", register: { kind: "dot" } },
  {
    id: "claude-code",
    name: "Claude Code",
    maker: "Anthropic",
    icon: "/agents/claude-code.jpg",
    register: { kind: "other", name: "Claude Code" },
    keyNote: "Keep it in an environment variable or the macOS Keychain, never in a file in a repo.",
  },
];

/** Where an agent's setup guide lives: /setup/<id>, or /setup for the generic one. */
export function setupPath(agent: ConnectableAgent | undefined) {
  return agent ? `/setup/${agent.id}` : "/setup";
}

/** What the person pastes into their agent: one line pointing at the setup guide (src/app/setup). */
export function connectPrompt(agent: ConnectableAgent | undefined, origin: string) {
  return `Set up AgentBnB using the instructions on ${origin}${setupPath(agent)}`;
}

/** A tile in the home banner. Named agents show their icon; "Any agent" shows a few examples. */
export type AgentTile = { id: string; name: string; maker: string; icon?: string; icons?: string[] };

/** The home banner's last tile: every other agent, with a few as examples. It copies the generic /setup prompt. */
export const ANY_AGENT_TILE: AgentTile = {
  id: "any",
  name: "Any agent",
  maker: "Claude Code & more",
  icons: ["/agents/claude-code.jpg", "/agents/poke.jpg", "/agents/manus.jpg", "/agents/grok-bot.jpg"],
};

/** What the home banner shows: the personal agents with their own setup, then "Any agent". */
export const HOME_AGENT_TILES: AgentTile[] = [
  ...CONNECTABLE_AGENTS.filter((a) => a.register.kind !== "other").map(({ id, name, maker, icon }) => ({ id, name, maker, icon })),
  ANY_AGENT_TILE,
];
