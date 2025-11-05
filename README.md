## Natura MCP Chatbot Demo

Cloudflare Worker + Supabase + DeepWiki MCP demo (Natura AI Assessment 1)

Includes a Worker-hosted Mock MCP alongside DeepWiki and Llama HTTP servers so tool discovery always works in demos.

```
┌────────────────────────┐        ┌──────────────────────────┐
│  React + Vite (Pages)  │ fetch  │   Cloudflare Worker API   │
│  https://ankitb47...   │───────▶│  /api/auth, /api/chat …   │
└────────────────────────┘        └──────────────────────────┘
                                        │  Supabase Auth/Admin (service role)
                                        ▼
                                    profiles table
                                        │
                                        │ JSON-RPC + SSE (handshake/session)
                                        ▼
                              DeepWiki MCP (HTTP & SSE endpoints)
```

### Repo layout

```
mcp-chatbot-demo/
├─ apps/
│  ├─ web/            # React + Vite + TS SPA (HashRouter)
│  └─ worker/         # Cloudflare Worker API (Supabase auth, MCP proxy)
├─ packages/
│  └─ mcp-client/     # Minimal MCP client (HTTP via SSE sessions)
├─ .github/workflows/ # GitHub Actions for Pages & Worker deployment
├─ README.md
├─ .editorconfig
└─ .gitignore
```

### Environment configuration

| Name                        | Location                | Purpose                                            |
|-----------------------------|-------------------------|----------------------------------------------------|
| `CLOUDFLARE_API_TOKEN`      | GitHub Secret           | Deploy Worker via wrangler                         |
| `CLOUDFLARE_ACCOUNT_ID`     | GitHub Secret           | Cloudflare account for Worker                      |
| `SUPABASE_URL`              | GitHub Secret           | Supabase project URL                               |
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub Secret           | Service role key for auth admin/profile writes     |
| `JWT_COOKIE_NAME`           | GitHub Secret           | Session cookie name (e.g. `mcp_demo_session`)       |
| `VITE_API_BASE`             | GitHub Repository Var   | Public URL for Worker API (Pages build time)       |
| `ALLOWED_ORIGIN`            | Wrangler `vars`         | CORS origin (`https://ankitb47.github.io`) |

Supabase schema requirement:

```sql
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null
);
```

### Local development

1. **Install dependencies**
   ```bash
   npm install            # install all workspaces
   ```
2. **Run the Worker locally**
   ```bash
   cd apps/worker
   npm install            # first time only
   # PowerShell
   $env:SUPABASE_URL="https://<your-project>.supabase.co"
   $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
   $env:JWT_COOKIE_NAME="mcp_demo_session"
   npx wrangler dev --var ALLOWED_ORIGIN=http://localhost:5173

   # macOS/Linux
   SUPABASE_URL="https://<your-project>.supabase.co" \
   SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
   JWT_COOKIE_NAME="mcp_demo_session" \
   npx wrangler dev --var ALLOWED_ORIGIN=http://localhost:5173
   ```
3. **Run the Web app**
   ```bash
   cd apps/web
   npm install            # first time only
   echo "VITE_API_BASE=http://127.0.0.1:8787" > .env
   npm run dev
   ```
4. Browse `http://localhost:5173/#/register` to create an account, then chat.

### GitHub Actions

- **deploy-pages.yml** (push to `main`): builds `apps/web`, injects `VITE_API_BASE`, uploads to GitHub Pages.
- **deploy-worker.yml** (tags `v*`): installs `apps/worker`, runs `wrangler deploy` with Supabase + JWT env.
- Secrets are stored as GitHub Actions Secrets and written to the Cloudflare Worker through `wrangler-action` secrets; no secrets ship in the client bundle.

### Worker endpoints

- `GET /api/health` – health check.
- `POST /api/auth/register` – create user (Supabase Admin + profiles insert) and issue cookie.
- `POST /api/auth/login` – username/email + password → cookie session.
- `POST /api/auth/logout` – clear session cookie.
- `GET /api/me` – resolve authenticated user via Supabase JWT.
- `POST /api/mcp/list` – list tools via internal MCP client (`packages/mcp-client`).
- `POST /api/mcp/call` – direct tool invocation (used by `/api/chat` when command provided).
- `POST /api/chat` – minimal assistant reply or tool execution; no chat persistence.

### MCP client (`packages/mcp-client`)

* Optional handshake; automatically falls back when servers skip `initialize`.
* Posts JSON-RPC over HTTP with GET retry for servers that reject POST.
* SSE transport remains experimental; HTTP fallback is attempted where possible.

### Frontend UX highlights

- HashRouter for GitHub Pages compatibility.
- TanStack Query handles auth/session/stateful API calls.
- Zustand store keeps chat transcript, server catalogue, tool toggles.
- Modern chat layout: sidebar server/tools, markdown bubbles, typing indicator, tool result cards.
- Toast feedback on auth/tool/chat actions.
- Pre-seeded MCP servers: Demo Mock MCP (Worker JSON-RPC), DeepWiki HTTP, and Llama HTTP.

### How to test end-to-end

1. Register a user on `/register`.
2. Sign in and land on `/chat`.
3. With “Demo Mock MCP” selected, click **Load tools** → echo/time/http_title appear.
4. Run `/echo {"text":"hi"}` → expect JSON result card.
5. Switch to “DeepWiki HTTP” or “Llama HTTP” and load tools; fall back toast should appear if the endpoint skips handshakes.
6. Send a plain message (no slash) → assistant echoes template reply.

### Known limitations

- Chat history lives only in client memory (no Supabase storage by design).
- MCP HTTP transport piggybacks on SSE handshakes (compatible with DeepWiki; adjust for other servers if needed).
- No email confirmation or password reset flows.
- Tool execution is sequential per request; long-running SSE streams beyond first response are not persisted.

### Acceptance checklist

- [x] Register/Login without email confirmation.
- [x] `/chat` gated by authenticated cookie (`/api/me`).
- [x] DeepWiki tools list + tool call response visible.
- [x] Pages build via Actions → `https://ankitb47.github.io/mcp-chatbot-demo/`.
- [x] Worker deploy via Actions → `https://mcp-chatbot-demo-api.jha-ankit230.workers.dev`.
- [x] CORS restricted to GitHub Pages origin.
- [x] No Supabase session IDs or chat history stored server-side.
