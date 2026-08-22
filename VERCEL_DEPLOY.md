# Vercel deployment

This repository is a monorepo. The deployable web frontend is `client/`.

Vercel Project Settings:
- Root Directory: `.` (repository root)
- Framework Preset: Vite
- Build Command: use `vercel.json`
- Output Directory: use `vercel.json`
- Install Command: use `vercel.json`

Do not set the Root Directory to `server-laravel` or `server` for the frontend deployment.

The current Vercel configuration builds `client/` and serves `client/dist`.
