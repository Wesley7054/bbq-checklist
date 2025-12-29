# BBQ Checklist & Wishlist (Static Web)

A simple static web app for a BBQ group:
- Checklist: tick items as done / bought
- Track **who bought** and **how much**
- Wishlist: ideas and optional items
- Export/Import JSON for syncing via GitHub
- Data stored in LocalStorage

## Run locally
Just open `index.html` in a browser.

## Deploy to GitHub Pages (get your link)
1. Create a new repo (e.g. `bbq-checklist`)
2. Upload these files: `index.html`, `styles.css`, `app.js`, `README.md`
3. Go to **Settings → Pages**
4. Under **Build and deployment**
   - Source: `Deploy from a branch`
   - Branch: `main` / `(root)`
5. Save, then your link will look like:
   `https://Wesley7054.github.io/bbq-checklist/`

## Team sync workflow (recommended)
- One person exports JSON (`Export JSON`)
- Commit that JSON file into repo (e.g. `data/latest.json`)
- Everyone downloads that JSON and imports it (`Import`)

> Tip: You can also keep the JSON file in the repo and update it by PR.
