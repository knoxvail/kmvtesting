# kmvtesting

Personal testing ground, deployed on Vercel. Each experiment lives in its own
folder and gets served at its own path.

## Adding an experiment

1. Make a new folder with an `index.html` in it (e.g. `my-thing/index.html`).
2. Add a link card for it in the root `index.html` (copy an existing `<li>`).
3. Commit and push — Vercel redeploys automatically.

The experiment will be live at `https://<project>.vercel.app/my-thing/`.
