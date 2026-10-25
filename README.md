# AI chat

A chat app on the Freebuff API: conversations in a sidebar, streamed replies
rendered as Markdown, a model picker, stop and regenerate, and a daily limit per
user. It runs on Freebuff Sites with Sign in with Freebuff and D1, and
everything is scoped to the signed-in user. The API key stays on the server.

Most customisation is one file: `src/shared/config.ts` holds the name, the
assistant's instructions, the models people may pick, the limits and the
suggestions on an empty chat.

## Run it

```sh
bun install
bun run dev        # http://localhost:5173 with local D1 (Miniflare)
bun run build      # dist/client (assets) + dist/ai_chat/index.js (Worker)
```

On localhost without a `FREEBUFF_CLIENT_ID`, the app signs you in as a local
development user and seeds one sample conversation. Until an API key is
configured, the app shows a setup card with a link to get one; it unlocks on
its own when the key arrives.

## The API key

The Worker calls the Freebuff API with `OPENAI_API_KEY` from its environment.
The key is a live credential that spends the owner's prepaid credits:

- Never ask for it in chat, print it, log it, commit it, or put it in browser
  code. The app only ever tells the browser whether a key is set.
- Locally it lives in `.env` (see `.env.example`), which Git ignores and
  Wrangler reads. Do not add a `.dev.vars` file: when one exists, Wrangler
  stops reading `.env`.
- The owner creates and funds a key at <https://freebuff.com/account/api>
  (Freebuff Desktop: Account → Developer API). Desktop can write the key into
  this project's `.env` from that page. In Freebuff Cloud, the owner adds it as
  a project secret named `OPENAI_API_KEY` in the project's settings; it reaches
  the dev server through `.env.local` on the next turn.
- On Freebuff Sites, after the first deploy, the owner sets `OPENAI_API_KEY` in
  Sites → Secrets (or you use `sites_set_secret` with a file the owner provided,
  without reading it). Deploy once before setting secrets.
- Suggest a monthly spend limit on the key, named after this app. The key's
  limits are the hard ceiling; the app's limits below are the soft one.

`OPENAI_BASE_URL` is optional and defaults to `https://freebuff.com/api/v1/paid`.

## How the Freebuff API works

It is OpenAI-compatible: `POST {base}/chat/completions` with `model`,
`messages`, `max_tokens` and optionally `stream`, authenticated with
`Authorization: Bearer fb_live_…`. `GET {base}/models` (no auth needed) lists
the models with `capabilities.streaming`; only some stream, and `stream: true`
on one that does not is a 400, so `src/worker/ai.ts` checks first and yields
the whole reply at once when streaming is off. Unknown request fields are
rejected; images, audio and embeddings are not supported.

Errors come as `{ "error": { "code", "message" } }`: `401 invalid_api_key`,
`402 insufficient_funds`, `403 key_disabled`/`model_not_allowed`,
`404 model_not_found`, `429 rate_limit`/`spend_limit`, `503` when a model is
unavailable. `ai.ts` maps each to a sentence the app can show. Requests are
billed from the key owner's prepaid balance by tokens, at the rates the
dashboard shows per model; a reply the API refuses costs nothing.

## Connect it to Freebuff Sites

1. `sites_create`, then `sites_add_storage` for D1 named `DB`.
2. `sites_enable_auth` (pass `http://localhost:5173` as the local origin while
   developing). Put the development variables in `.env` to use real accounts
   locally.
3. `bun run build`, then `sites_deploy` with `deploy.json`.
4. The owner sets `OPENAI_API_KEY` in Sites → Secrets. Until then the deployed
   app shows the setup card.

Sign in with Freebuff is required on a deployed site: without it nobody can
chat, because every reply spends the owner's credits.

## Where things are

- `src/shared/config.ts`: name, tagline, system prompt, `MODELS` (the picker
  and the server-side allowlist), `DEFAULT_MODEL`, `DAILY_MESSAGE_LIMIT`,
  context and length caps, suggestions.
- `src/worker/` is the Hono API. `ai.ts` talks to the Freebuff API (model
  capabilities, streaming, error mapping). `routes/chat.ts` is one turn: it
  checks the limits, stores the question, streams the reply as server-sent
  events and stores it when done, keeping a stopped reply's partial text.
  `routes/conversations.ts` lists, renames and deletes chats;
  `routes/account.ts` serves `/me` (capabilities and today's usage) and
  `/models`. `db.ts` owns the schema (created on first request), `auth.ts`
  the Freebuff integration and the loopback-only development user, `seed.ts`
  the sample conversation.
- `src/app/` is the React app. `pages/Chat.tsx` is the thread and composer;
  `lib/turn.ts` holds the reply in flight so it survives the move from `/` to
  `/c/:id`; `lib/stream.ts` reads the event stream; `components/Markdown.tsx`
  renders replies (no raw HTML, links open in a new tab); `components/ui.tsx`
  holds the primitives.
- `src/styles.css` holds the design tokens and the reply typography.
  Everything rounded is a squircle via `corner-shape`; true circles use the
  `round` class.

## Security notes

Every `/api/*` route requires a signed-in user and scopes queries by
`owner_sub`; mutations must be same-origin. The Worker refuses any model that is
not in `MODELS`, caps messages at `MAX_MESSAGE_CHARS`, sends at most
`MAX_CONTEXT_MESSAGES` of history and `MAX_OUTPUT_TOKENS` per reply, and allows
`DAILY_MESSAGE_LIMIT` replies per user per UTC day (counting stopped and
regenerated ones; refused requests are free). Keep these when extending the
app, and keep the development user loopback-only: on a deployed origin it must
never activate. Personalised responses are `Cache-Control: private, no-store`.
