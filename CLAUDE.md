# food-tracker — Claude Code Guide

## What this project is

MealJot is a privacy-first, local-first nutrition tracker. All data lives as plain markdown files — no backend, no database. The app runs entirely in the browser.

Live at: https://shivbijlani.github.io/food-tracker/
Upstream repo: https://github.com/shivbijlani/food-tracker

## Running locally

```
npm install
npm run dev        # starts at http://localhost:5173
npm run build      # production build
```

The `predev` / `prebuild` scripts run `scripts/copy-sw.mjs` automatically — this copies the folder-sync service worker into `public/`. Don't skip it.

Open in Chrome or Edge (Firefox lacks the File System Access API needed for local folder mode).

## Tech stack

- React 19 + Vite 8 (no TypeScript — plain `.jsx` / `.js`)
- `@shivbijlani/folder-sync` — workspace package in `packages/folder-sync/` that wraps storage adapters and cloud sync providers
- `idb-keyval` — IndexedDB persistence for folder handles
- No test framework currently
- No CSS framework — custom styles in `src/index.css`

## Architecture

### Storage (`src/storage/`)

The app has two layers:

**Primary (local) adapters** — where the app reads/writes:
- `browser-storage` — localStorage-backed, works everywhere, no setup
- `fsa` — File System Access API, Chrome/Edge desktop only, real files on disk

**Cloud sync providers** — optional background sync targets:
- OneDrive (pre-registered Azure app ID already in the code — no Azure setup needed)
- Google Drive (requires `VITE_GOOGLE_CLIENT_ID` env var)

`storage.js` is the public facade. The app calls `storage.readFile()` / `storage.writeFile()` — it never talks to adapters directly. The sync engine lives in `packages/folder-sync/`.

### Data files

Three markdown files hold all user data:
- `goals.md` — daily nutrition targets
- `recipes.md` — per-serving nutrition for homemade items
- `entries-YYYY-MM.md` — food log entries, one file per month

All files are YAML-frontmatter + markdown table format, parsed by `src/storage/mdyaml.js`.

### Components (`src/`)

| File | What it does |
|------|--------------|
| `App.jsx` | Root — tabs, storage init, all major views as nested functions |
| `SimpleMode.jsx` | Simplified protein-only mode UI |
| `llm.js` | LLM provider abstraction (OpenRouter, GitHub, OpenAI, Claude) |
| `openrouter-auth.js` | OpenRouter OAuth flow |
| `StatusBadge.jsx` | Sync status indicator |
| `SettingsButton.jsx` | Floating settings gear icon |
| `Footer.jsx` | App footer |
| `branding.js` | App name / branding constants |

`App.jsx` is large — it contains `TodayView`, `AddEntry`, `LogView`, `RecipesView`, `GoalsView`, `StorageAndSyncCard`, and `SettingsView` all as top-level functions in the same file. Keep new features in that pattern unless the component is clearly reusable elsewhere.

### Two modes

- **Simple** — protein-only, success/failure system (`systems.md` file)
- **Advanced** — full macros: calories, protein, calcium, veg servings, omega-3

Mode is stored in localStorage and auto-detected from existing data files.

## Contributing workflow

This is a fork — contributions go back to the upstream via PR.

1. Make changes on a feature branch: `git checkout -b feat/your-feature`
2. Test in the browser (run `npm run dev`)
3. Push and open a PR against `shivbijlani/food-tracker`

No linter is enforced in CI yet, but `npm run lint` runs ESLint locally.

## Ongoing contributions

### UX: demystify cross-device sync
The "Cloud sync" section in Settings uses technical language. Replace it with plain UX that explains:
- OneDrive uses the AppFolder scope — files land at `Apps/MealJot Food Tracker/` in the user's OneDrive (not a root-level folder)
- You can open those files from any device (phone, tablet, other computer)
- The files are plain text — Claude, Copilot, or any AI agent can edit them
- Implement via an ⓘ info popover next to the section heading

Files to edit: `src/App.jsx` — `StorageAndSyncCard` component (~line 672) and the "Data files" card in `SettingsView`.

## Key constraints

- No backend — everything runs in the browser
- Don't add new npm dependencies without a strong reason
- Keep plain JS (no TypeScript migration)
- OneDrive sync works without any Azure setup — the client ID is already registered
