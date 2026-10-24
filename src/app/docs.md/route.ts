// Plain-Markdown API docs for personal agents (Instinct, Dot, Muse, ...). Hand an agent this URL.

const docs = (base: string) => `# AgentBnB API

AgentBnB finds people a free place to stay: couches, house sits and work exchanges.
This API lets a person, or a personal agent acting for them, use AgentBnB.

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

## Check a key

\`GET /me\` returns who the key belongs to: \`{ keyId, user, agent }\`. \`agent\` is null for the person's own key.

\`\`\`bash
curl ${base}/api/v1/me -H 'authorization: Bearer abnb_...'
\`\`\`

## Keys

- \`GET /keys\`: the person's active keys, \`{ data: [{ id, prefix, agent, createdAt, lastUsedAt }] }\`.
- \`POST /keys\` with \`{ "agent": { "kind": "muse" } }\`: a new key for another agent of the same person, e.g. Instinct connecting Muse.
  Send \`{}\` for a key the person holds themself (person keys only). Same response shape as \`/register\`.
- \`DELETE /keys/{id}\`: revoke a key. Person keys can revoke any of the person's keys; an agent key can only revoke itself.
`;

export function GET(req: Request) {
  const base = new URL(req.url).origin;
  return new Response(docs(base), { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
