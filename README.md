# Food Tracker

A local-first food & nutrition tracker. Inspired by the [focus-planner](https://github.com/shivbijlani/focus-planner) architecture: your data lives in a folder you pick, as plain markdown files — not in a database, not on a server.

## Features

- **Today** — at-a-glance progress vs. your daily goals (calories, protein, calcium, veg servings, omega-3).
- **Add entry** — type what you ate; optionally let an LLM estimate the nutrition values, edit, and save.
- **Log** — full daily history grouped by day with per-day totals.
- **Recipes** — saved per-serving nutrition for things you eat often. Recipes are passed as context to the LLM so "two servings of [recipe]" estimates accurately.
- **Goals** — edit your daily targets.
- **Settings** — pick a folder, set your OpenAI API key & model.

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
