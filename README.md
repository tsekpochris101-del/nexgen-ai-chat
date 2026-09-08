# nexGen AI Chat

A self-contained Vite + React + Express web app for **nexGen — Your intelligent AI companion.**

## Run locally in development

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

The app works without an AI key using an explicit development response. To use Groq, add the key to `.env`:

```env
GROQ_API_KEY=your-server-side-key
GROQ_MODEL=openai/gpt-oss-120b
```

The keys are read only by the Express server and are never exposed to the browser.

## Run as a standalone web app

```bash
npm install
npm run build
NODE_ENV=production npm start
```

Open `http://localhost:4000`. Express serves both the built React frontend and the `/api` backend from the same origin, so the app does not depend on Replit or a separate frontend server. Set `PORT` and `HOST` when your hosting provider supplies them.

### Docker

```bash
docker build -t nexgen .
docker run --env-file .env -p 4000:4000 nexgen
```

Then open `http://localhost:4000`. The container listens on `0.0.0.0` and is ready for any Docker-compatible host, VPS, or cloud deployment service. Configure `GROQ_API_KEY`, and optionally `EXA_API_KEY` and `ADMIN_EMAIL`, as server-side environment variables on that host.

### Vercel Hobby

The repository also includes `vercel.json` and `api/index.js` for a free Vercel deployment. Import the project into Vercel, keep the default build settings, and add `GROQ_API_KEY`, `EXA_API_KEY`, and `ADMIN_EMAIL` under the project's environment variables. Vercel will serve the React build and route `/api/*` to the Express function.

## Included

- Responsive premium SaaS-style chat interface
- Signup, login, logout, and HttpOnly session cookies
- Server-side password hashing with Node `scrypt`
- Conversation creation, selection, title generation fallback, search, and deletion
- Safe Markdown with GFM, sanitized links, and copyable code blocks
- Groq-compatible backend service with configurable model
- Exa-backed live web search with source links and a Web toggle in the composer
- Server-owned creator identity: Tsekpo Chris, a self-taught programmer
- Explicit mock response mode when `GROQ_API_KEY` is not configured
- Backend ownership checks for conversations
- Protected admin overview endpoint scaffold
- Admin operations workspace with maintenance requests, change requests, integration health, and future-feature roadmap
- Theme toggle, mobile navigation drawer, keyboard shortcuts, and reduced-motion support

## Important starter limitations

The current store is intentionally in-memory for a runnable scaffold. Restarting the server clears users, sessions, conversations, and messages. Replace the maps in `server/index.js` with a relational database before production, and add migrations, persistent session storage, email verification, password reset, CSRF strategy, rate limiting, file upload validation, and streaming cancellation.

The live search feature uses Exa directly through `EXA_API_KEY`, keeping the credential server-side. Search can be enabled with the **Web** button, and current-looking questions also trigger search automatically. Without an Exa key, the app still runs but returns answers without live web sources.

## Deploy outside Replit

1. Upload the project or build the Docker image on the host of your choice.
2. Set the host's public `PORT` if it provides one; the server already binds to `HOST=0.0.0.0`.
3. Add `GROQ_API_KEY` and `EXA_API_KEY` as server-side secrets.
4. Set `ADMIN_EMAIL` if the admin dashboard is needed.
5. Use the host's generated HTTPS URL. No Replit connector, domain, or runtime secret is required.

The included `Dockerfile` and Vercel configuration are portable deployment paths. The app currently stores users, sessions, conversations, and messages in memory, so attach a persistent database before treating an external deployment as production data storage.

## API shape

```text
POST   /api/auth/signup
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/session
GET    /api/conversations
POST   /api/conversations
GET    /api/conversations/:id
PATCH  /api/conversations/:id
DELETE /api/conversations/:id
POST   /api/conversations/:id/messages
GET    /api/admin/overview
GET    /api/admin/workspace
POST   /api/admin/maintenance
PATCH  /api/admin/maintenance/:id
POST   /api/admin/changes
PATCH  /api/admin/changes/:id
```