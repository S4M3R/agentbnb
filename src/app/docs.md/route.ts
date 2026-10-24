// Plain-Markdown API docs for personal agents (Instinct, Dot, Muse, ...). Hand an agent this URL.

const docs = (base: string) => `# AgentBnB API

AgentBnB finds people a free place to stay: couches, house sits and work exchanges.
This API lets a person, or a personal agent acting for them, use AgentBnB: talk to it agent-to-agent (A2A), manage
keys, keep their public profile up to date, see stay requests for their place, and run background checks on guests.

Setting up for the first time? Follow \`${base}/setup\` (or \`${base}/setup/<agent id>\`); it walks you through registering, storing the key and
the first conversation. This page is the full reference.

Base URL: \`${base}/api/v1\`. Bodies and responses are JSON.

## Authentication

Every endpoint except \`POST /register\` needs \`Authorization: Bearer <api key>\`.
A key belongs to one person and is held either by that person or by one of their agents.
Keys start with \`abnb_\` and are shown only once, when created. Store them in a secret store, never in chat.

Errors look like \`{ "error": { "code": "UNAUTHENTICATED", "message": "..." } }\`. Branch on \`code\`.

| code | status | meaning |
| --- | --- | --- |
| \`UNAUTHENTICATED\` | 401 | Missing, unknown or revoked key. |
| \`INVALID_BODY\` | 400 | The body failed validation; \`message\` says which field. |
| \`EMAIL_TAKEN\` | 409 | That email is already registered. Use one of the person's existing keys to create another (\`POST /keys\`). |
| \`PERSON_KEY_REQUIRED\` | 403 | Agent keys can't create person keys or revoke other keys. |
| \`KEY_NOT_FOUND\` | 404 | No active key with that id for this person. |
| \`REQUEST_NOT_FOUND\` | 404 | No stay request with that id for this person. |
| \`CHECK_NOT_FOUND\` | 404 | No background check with that id that this person can see. |
| \`UNKNOWN_SOURCE\`, \`INVALID_SOURCE\` | 400 | \`source\` isn't an external platform we know. |
| \`UNKNOWN_LISTING\` | 400 | \`listingId\` isn't one of the person's own listings. |

## Register

\`POST /register\`, no auth. Agents register themselves and their person in one call.

\`\`\`bash
curl -X POST ${base}/api/v1/register \\
  -H 'content-type: application/json' \\
  -d '{
    "person": { "name": "Ada Lovelace", "email": "ada@example.com", "homeCity": "San Francisco" },
    "agent": { "kind": "instinct" }
  }'
\`\`\`

- \`person.name\`, \`person.email\` are required; \`homeCity\` and \`bio\` are optional.
- \`agent.kind\` is one of \`instinct\`, \`dot\`, \`muse\`, \`other\`. For \`other\`, also send \`agent.name\` (e.g. \`"OpenClaw"\`).
- Leave out \`agent\` when the person registers themself.

Response (201):

\`\`\`json
{
  "apiKey": "abnb_...",
  "key": { "id": "…", "prefix": "abnb_xxxxxxx" },
  "user": { "id": "…", "name": "Ada Lovelace", "email": "ada@example.com" },
  "agent": { "id": "…", "kind": "instinct", "name": "Instinct" }
}
\`\`\`

Registering is not idempotent: a second call with the same email returns \`EMAIL_TAKEN\`.

## Talk to AgentBnB over A2A

AgentBnB is also an [A2A](https://a2a-protocol.org) agent, so your agent can just talk to it: "my person landed in
Oakland and needs a couch tonight", "put my place up this weekend". The agent card is at
\`${base}/.well-known/agent-card.json\`; the JSON-RPC endpoint is \`${base}/a2a\` (A2A 1.0, and 0.3 for older SDKs).

- Searching needs no key. Hosting (listing the person's place) needs their key as \`Authorization: Bearer abnb_...\`.
- \`SendMessage\` (0.3: \`message/send\`) answers synchronously with a completed task. Reuse the task's
  \`contextId\` on the next message to continue the conversation. \`GetTask\`, \`ListTasks\` work too; streaming and
  push notifications don't.
- Attach photos of the person's place as image parts (\`{ "url": ..., "mediaType": "image/jpeg" }\` or
  \`{ "raw": <base64>, ... }\`); we copy them, so short-lived URLs are fine.

\`\`\`bash
curl ${base}/a2a -H 'content-type: application/json' -H 'A2A-Version: 1.0' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "SendMessage",
  "params": { "message": { "messageId": "m1", "role": "ROLE_USER",
    "parts": [{ "text": "I just got to San Francisco and need a place for the weekend. I love cats." }] } }
}'
\`\`\`

The reply (\`result.task.status.message\`) is short, plain text written for the person, ending with a link like
\`${base}/s/aB3dE5fG7h\`. Send the reply as is, or at least send the link **as its own message**: in iMessage it unfolds
into a preview card with the stays' photos, and the page shows each stay with a button to apply on its site. The link
is also in \`artifacts\` (\`parts[1].data\`: \`{ url, title, listings, image }\`, where \`image\` is the preview).

## Check a key

\`GET /me\` returns who the key belongs to: \`{ keyId, user, agent }\`. \`agent\` is null for the person's own key.

\`\`\`bash
curl ${base}/api/v1/me -H 'authorization: Bearer abnb_...'
\`\`\`

## Profile

Every member has a public profile at \`${base}/people/{userId}\` that hosts read before saying yes: name, photo,
bio, home city, languages, a Verified badge, when they joined, and their live AgentBnB listings (area only).
Email is never shown.

\`PATCH /me\` updates it. Send only the fields you want to change; the rest keep their value.

\`\`\`bash
curl -X PATCH ${base}/api/v1/me -H 'authorization: Bearer abnb_...' -H 'content-type: application/json' -d '{
  "name": "Agus",
  "homeCity": "Buenos Aires, Argentina",
  "languages": ["Spanish", "English"],
  "bio": "Designer from Buenos Aires. I travel with a backpack and a camera, and I cook for my hosts."
}'
\`\`\`

| field | type | rules |
| --- | --- | --- |
| \`name\` | string | 1-80 characters. |
| \`avatarUrl\` | string or null | An \`https\` image URL, up to 2048 characters. \`null\` removes the photo. |
| \`bio\` | string or null | Up to 1000 characters. Empty or \`null\` clears it. |
| \`homeCity\` | string or null | Up to 120 characters, e.g. \`"Buenos Aires, Argentina"\`. Empty or \`null\` clears it. |
| \`languages\` | string[] | Up to 10, each up to 40 characters. Replaces the list; duplicates are dropped. |

Unknown fields (including \`email\`) are rejected with \`INVALID_BODY\`. Response (200):

\`\`\`json
{
  "profile": {
    "id": "…", "name": "Agus", "email": "agus@example.com", "avatarUrl": null,
    "bio": "Designer from Buenos Aires. …", "homeCity": "Buenos Aires, Argentina",
    "languages": ["Spanish", "English"], "verified": false, "memberSince": "2026-10-24T18:00:00.000Z",
    "url": "${base}/people/…"
  }
}
\`\`\`

## Keys

- \`GET /keys\`: the person's active keys, \`{ data: [{ id, prefix, agent, createdAt, lastUsedAt }] }\`.
- \`POST /keys\` with \`{ "agent": { "kind": "muse" } }\`: a new key for another agent of the same person, e.g. Instinct connecting Muse.
  Send \`{}\` for a key the person holds themself (person keys only). Same response shape as \`/register\`.
- \`DELETE /keys/{id}\`: revoke a key. Person keys can revoke any of the person's keys; an agent key can only revoke itself.

## Stay requests (hosting)

Everyone who asked to stay at the person's place, from AgentBnB and from the external networks their place is on.

- \`GET /requests\`: \`{ requests: [...] }\`, open ones first. Filter with \`?status=new,replied\`
  (statuses: \`new\`, \`replied\`, \`accepted\`, \`declined\`, \`expired\`, \`withdrawn\`). Each request has
  \`guest\` (what the platform shows: \`name\`, \`profileUrl\`, \`location\`, \`references\`, ...), \`guestUserId\`
  (set when the guest is an AgentBnB member: their profile is at \`/people/{guestUserId}\`), \`message\`,
  \`startDate\`/\`endDate\`, \`source\`, \`listing\` and the latest \`check\` (\`{ id, status, verdict, summary }\` or null).
- \`POST /requests\`: import a request the person got on an external platform, e.g. one you read in their
  Couchsurfing inbox. Importing the same \`source\` + \`externalRef\` again updates it.

\`\`\`bash
curl -X POST ${base}/api/v1/requests -H 'authorization: Bearer abnb_...' -H 'content-type: application/json' -d '{
  "source": "couchsurfing",
  "externalRef": "cs-request-8812",
  "externalUrl": "https://www.couchsurfing.com/messages/8812",
  "guest": { "name": "Lena Hoffmann", "profileUrl": "https://www.couchsurfing.com/people/lena", "location": "Hamburg", "references": 23 },
  "message": "Could I stay two nights?",
  "startDate": "2026-11-06",
  "endDate": "2026-11-08"
}'
\`\`\`

  \`source\` is a platform id: \`couchsurfing\`, \`bewelcome\`, \`trustroots\`, \`couchers\`, \`warmshowers\`,
  \`trustedhousesitters\`, \`workaway\`, \`worldpackers\`, \`helpx\`, \`nomador\`, \`mindmyhouse\`, \`housecarers\`,
  \`housesittersamerica\`, \`wwoof-usa\`. Internal requests appear on their own.
- \`POST /requests/{id}/respond\` with \`{ "decision": "accept" }\` or \`"decline"\`. For external requests the
  response includes \`answerOnPlatform\`: the person still has to answer there.

## Background checks

A host can have AgentBnB look up a guest before answering. The check searches the public web for the guest
(their platform profile, the same person on other networks, references, anything that doesn't add up) and builds
a sourced profile as it goes. Public information only: never criminal, court or credit records, nothing behind a
login. Guests who are AgentBnB members can read checks about themselves. Checks are deleted 30 days after the
host answers or the stay ends (90 days if the request is never answered).

- \`POST /requests/{id}/background-check\`: start one. Returns \`{ check: { id, started } }\` (202 when it started,
  200 with the running check if one is already going). Takes a minute or two.
- \`GET /background-checks/{id}\`: the check so far. Poll every second or two while \`status\` is \`running\`;
  pass \`?after=<last event id>\` to get only new \`events\`. Fields:
  - \`status\`: \`running\`, \`done\` or \`failed\` (with \`error\`; findings so far are kept).
  - \`verdict\`: \`consistent\`, \`some_gaps\` (nothing wrong, not much to go on) or \`red_flags\`; \`summary\`.
  - \`profile\`: who the guest seems to be: \`name\`, \`headline\`, \`location\`, \`occupation\`, \`languages\`,
    \`identity\` (\`strong\` / \`partial\` / \`weak\` / \`unknown\`) and \`profiles\` (\`[{ platform, url, note }]\`).
  - \`findings\`: \`[{ category, title, detail, sourceUrl, sourceTitle, confidence }]\`, category \`identity\`,
    \`reputation\`, \`presence\` or \`red_flag\`.
  - \`questions\` worth asking the guest, \`unverified\` things it couldn't confirm, and \`events\` (the live log).
  - \`viewer\`: \`host\` or \`guest\`.

Tell the person what the check found in a sentence or two, lead with any red flags, and leave the decision to them.
`;

export function GET(req: Request) {
  const base = new URL(req.url).origin;
  return new Response(docs(base), { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
