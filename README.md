# lulu_q

Private two-person app. Cloudflare Worker + static assets + D1.

- Every request (pages and API) passes through `src/worker.js`, which verifies the
  Cloudflare Access token and only lets in the two emails in `wrangler.jsonc`.
  Anyone else, or any request while `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` are empty, gets a plain 404.
- After Access, each person sets an app passcode (PIN). The first screen is a neutral
  passcode pad; nothing else loads until the PIN is right. Auto-locks after 5 minutes in the background.
- The database schema is created automatically on first use.

## Local
    npm test                                              # logic + end-to-end Worker tests
    node --experimental-sqlite scripts/dev-server.mjs     # http://localhost:8787/?as=queen  (or ?as=slave)

## Deploy
Push to `main`. Cloudflare Workers Builds runs `npm run build` then `npx wrangler deploy`.
