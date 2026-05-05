import { get, set } from 'idb-keyval'

const DB_KEY = 'food-tracker-dir-handle'

export function isSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export async function pickFolder() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  await set(DB_KEY, handle)
  return handle
}

export async function restoreFolder() {
  const handle = await get(DB_KEY)
  if (!handle) return null
  try {
    const permission = await handle.queryPermission({ mode: 'readwrite' })
    if (permission === 'granted') return handle
    return null
  } catch {
    return null
  }
}

export async function ensurePermission(handle) {
  if (!handle) return false
  const permission = await handle.queryPermission({ mode: 'readwrite' })
  if (permission === 'granted') return true
  const requested = await handle.requestPermission({ mode: 'readwrite' })
  return requested === 'granted'
}

async function getFileHandle(dirHandle, path, create = false) {
  const parts = path.split('/')
  const filename = parts.pop()
  let dir = dirHandle
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create })
  }
  return dir.getFileHandle(filename, { create })
}

export async function readFile(dirHandle, path) {
  const fh = await getFileHandle(dirHandle, path)
  const file = await fh.getFile()
  return file.text()
}

export async function writeFile(dirHandle, path, content) {
  const fh = await getFileHandle(dirHandle, path, true)
  const writable = await fh.createWritable()
  await writable.write(content)
  await writable.close()
}

export async function fileExists(dirHandle, path) {
  try {
    await getFileHandle(dirHandle, path)
    return true
  } catch {
    return false
  }
}

const SCAFFOLD_DAILY_LOG = `# Daily Food Log

This file is the source of truth for all logged meals. Each row is one meal/food entry.
Edit by hand or via the Food Tracker app.

| Date | Meal | Food Description | Calories | Protein (g) | Calcium (mg) | Veg Servings | Omega-3 | Notes |
|------|------|------------------|----------|-------------|--------------|--------------|---------|-------|
`

const SCAFFOLD_GOALS = `# Daily Nutrition Goals

| Nutrient | Target | Notes |
|----------|--------|-------|
| Calories | 1400-1600 kcal | Gentle deficit |
| Protein | 90-120 g | Muscle, satiety |
| Calcium | 1000-1200 mg | Bone health |
| Vegetables | 5+ servings | Fiber, vitamins |
| Omega-3 | Daily | Fatty fish, walnuts, flax |
| Hydration | 80-100 oz | |
`

const SCAFFOLD_RECIPES = `# Recipes

Per-serving nutrition for homemade items. Reference these in meal descriptions.

| Recipe | Servings | Calories | Protein (g) | Calcium (mg) | Notes |
|--------|----------|----------|-------------|--------------|-------|
`

export async function scaffoldIfEmpty(dirHandle) {
  if (!(await fileExists(dirHandle, 'daily-log.md'))) {
    await writeFile(dirHandle, 'daily-log.md', SCAFFOLD_DAILY_LOG)
  }
  if (!(await fileExists(dirHandle, 'goals.md'))) {
    await writeFile(dirHandle, 'goals.md', SCAFFOLD_GOALS)
  }
  if (!(await fileExists(dirHandle, 'recipes.md'))) {
    await writeFile(dirHandle, 'recipes.md', SCAFFOLD_RECIPES)
  }
}


const SCAFFOLD_PROTEIN_LOG = `# Protein Log

| Date | Meal | Protein (g) |
|------|------|-------------|
`

const SCAFFOLD_SYSTEMS = `# Systems

Add your success and failure systems here.
`

const SCAFFOLD_GOALS_SIMPLE = `# Daily Nutrition Goals

| Nutrient | Target | Notes |
|----------|--------|-------|
| Protein | 100 g | Daily protein goal |
`

export async function scaffoldSimpleModeIfEmpty(dirHandle) {
  if (!(await fileExists(dirHandle, 'protein-log.md'))) {
    await writeFile(dirHandle, 'protein-log.md', SCAFFOLD_PROTEIN_LOG)
  }
  if (!(await fileExists(dirHandle, 'systems.md'))) {
    await writeFile(dirHandle, 'systems.md', SCAFFOLD_SYSTEMS)
  }
  if (!(await fileExists(dirHandle, 'goals.md'))) {
    await writeFile(dirHandle, 'goals.md', SCAFFOLD_GOALS_SIMPLE)
  }
}
