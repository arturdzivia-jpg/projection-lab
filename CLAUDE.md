# Deployment

This project is hosted on **Vercel**. Vercel auto-deploys from the git repo:

- Pushes to `main` → production deploy.
- Pushes to any other branch → preview deploy.

## Workflow for Claude

**Do not run a local dev server.** A local Vite server is not part of this project's workflow — the user reviews every change on the deployed Vercel URL.

To get a change in front of the user:

1. Make the edit.
2. Commit it.
3. Push (to `main` for production, or to a branch for a Vercel preview).

Then point the user at the deployed URL — no `npm run dev`, no `localhost`.

When troubleshooting "it doesn't work" reports based on a screenshot, remember the screenshot is the deployed build. Local file changes won't appear there until they're committed and pushed.
