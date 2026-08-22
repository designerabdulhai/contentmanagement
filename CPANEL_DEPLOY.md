# cPanel Deployment

This project is prepared to run as one Node.js application on cPanel. Express serves the built React app and the `/api` endpoints from the same domain.

## Requirements

Your cPanel hosting must provide **Setup Node.js App / Node.js Selector / Passenger**. A PHP-only shared hosting plan is not enough.

## 1. Upload the project

Upload/clone the repository into a directory outside `public_html` if your host allows it, for example:

`/home/USERNAME/contentmanagement`

## 2. Create the Node.js application

In cPanel:

- Open **Setup Node.js App**.
- Create a Node.js application.
- Choose a supported Node.js version (Node 18+ recommended).
- Application root: `contentmanagement`
- Application URL: your domain or a subdomain such as `cms.example.com`
- Application startup file: `server/index.js`
- Application mode: Production

## 3. Install dependencies

Open cPanel Terminal and run from the project root:

```bash
npm install
npm run build
npm run init-db
```

`npm run build` installs the React dependencies and creates `client/dist`.

## 4. Environment variables

Add these in the Node.js application's Environment Variables section:

```text
NODE_ENV=production
PORT=4000
CORS_ORIGIN=https://YOUR-DOMAIN.com
MAX_BODY_SIZE=1mb
```

Do not put a real secret/token/password in the repository.

## 5. Database permissions

The application creates `server/data.sqlite` when started. The Node.js process must have read/write permission to the `server` directory.

If the database was initialized before deployment, keep `server/data.sqlite` and back it up regularly.

## 6. Restart the application

Use **Restart Application** in cPanel after installing dependencies/building the frontend.

## 7. Test

Open:

```text
https://YOUR-DOMAIN.com/api/health
```

Expected response:

```json
{"ok":true}
```

Then open the normal domain. The React dashboard should load from the same Node.js process.

## Important

Do not upload `client/src` as the public website by itself. The production site is `client/dist`, and Express now serves that build automatically.

Do not expose `server/data.sqlite` as a public static file. Keep the project directory outside `public_html` where possible.

For a real production deployment, authentication/authorization should be completed before opening the dashboard to the public internet.
