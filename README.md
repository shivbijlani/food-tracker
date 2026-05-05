# Food Tracker

A local-first food & nutrition tracker with mobile support. Inspired by the [focus-planner](https://github.com/shivbijlani/focus-planner) architecture: your data lives as plain markdown files — not in a database, not on a server.

## Features

- **Two Modes**: Simple (protein-only tracking with progress bars) or Advanced (full nutrition tracking)
- **Today** — at-a-glance progress vs. your daily goals (calories, protein, calcium, veg servings, omega-3).
- **Add entry** — type what you ate; optionally let an LLM estimate the nutrition values, edit, and save.
- **Log** — full daily history grouped by day with per-day totals.
- **Recipes** — saved per-serving nutrition for things you eat often.
- **Goals** — edit your daily targets.
- **Mobile Support** — OneDrive sync enables access from any device
- **LLM Integration** — GitHub Models (free), OpenAI, or Claude for nutrition estimation

## Storage Options

### 🖥️ Local Folder (Desktop Only)
- **How**: Uses [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
- **Where**: Files stored in a folder you choose on your computer
- **Pros**: Complete privacy, works offline, you own the files
- **Cons**: Desktop Chrome/Edge only, no mobile access

### 📱 OneDrive (Mobile + Desktop)
- **How**: Files stored in your OneDrive (`/food-tracker/` folder)
- **Where**: Synced across all your devices
- **Pros**: Works on mobile, automatic backup, cross-device sync
- **Cons**: Requires Azure app registration (one-time setup)

**Mobile Setup**: See [MOBILE_SETUP.md](MOBILE_SETUP.md) for OneDrive configuration instructions.

## Architecture

- **No backend.** All data is read/written via the browser's [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) (Chromium browsers only — Chrome, Edge, Brave, Arc).
- **Markdown as DB.** Three files in your chosen folder:
  - `daily-log.md` — every food entry as a markdown table row
  - `recipes.md` — saved recipes (per-serving nutrition)
  - `goals.md` — your daily targets
- **Folder handle persisted** in IndexedDB via `idb-keyval`, so the app remembers your folder across reloads.
- **LLM** — your OpenAI API key is stored in `localStorage` and sent only to `api.openai.com`. Default model `gpt-4o-mini`.

## Data format

Each entry has: Date, Meal, Food Description, Calories, Protein (g), Calcium (mg), Veg Servings, Omega-3 (Y/N), Notes.

This matches the columns of a spreadsheet-based food log, so you can open the markdown files in any editor and read or edit them by hand.

## Run

```sh
npm install
npm run dev
```

Then open http://localhost:5173 in a Chromium browser, go to **Settings**, pick a folder, and (optionally) paste your OpenAI API key.

## Build

```sh
npm run build
```
