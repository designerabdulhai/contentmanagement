# Cloudflare Worker API

This folder replaces the Express + better-sqlite3 API when deploying the app without cPanel.

## 1. Configure D1

Open Cloudflare → D1 → `contentmanagement` → Settings and copy the database ID into `worker/wrangler.toml`:

```toml
database_id = "YOUR_D1_DATABASE_ID"
```

The D1 tables should already exist. If the database is empty, run the schema from the repository's `server/init_db.js` converted to SQL, or use the D1 Console to create the seven tables.

## 2. Deploy

From the repository root:

```bash
npx wrangler login
npx wrangler deploy --config worker/wrangler.toml
```

Cloudflare will return a URL similar to:

```text
https://contentmanagement-api.<your-subdomain>.workers.dev
```

Test:

```text
https://contentmanagement-api.<your-subdomain>.workers.dev/api/health
```

Expected response:

```json
{"ok":true,"database":"D1"}
```

## 3. Connect Vercel frontend

In Vercel → Project → Settings → Environment Variables, add:

```text
VITE_API_URL=https://contentmanagement-api.<your-subdomain>.workers.dev/api
```

Redeploy the frontend after saving the variable.

## API compatibility

The Worker implements the current frontend API routes for posts, bulk scheduling, project suggestions, dashboard summary, due-soon, overdue checks, templates, notes, settings, users and invites.
