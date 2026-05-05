#!/usr/bin/env node
/**
 * Usage: node scripts/bootstrap-shiv.js <output-folder>
 *
 * Writes simple mode markdown files from Shiv's original protein tracking data:
 *   protein-log.md, systems.md, goals.md
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

if (!process.argv[2]) {
  console.error('Usage: node scripts/bootstrap-shiv.js <output-folder>')
  process.exit(1)
}

const outFolder = path.resolve(process.argv[2])
fs.mkdirSync(outFolder, { recursive: true })

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeCell(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function serializeTable(headers, rows) {
  const headerLine = `| ${headers.join(' | ')} |`
  const sepLine = `|${headers.map(() => '------').join('|')}|`
  const bodyLines = rows.map(r => `| ${r.map(escapeCell).join(' | ')} |`)
  return [headerLine, sepLine, ...bodyLines].join('\n')
}

// Convert "Mon DD, YYYY" → "YYYY-MM-DD"
function parseDate(str) {
  const d = new Date(str)
  if (isNaN(d)) return str
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Protein log entries ───────────────────────────────────────────────────────
const entries = [
  { date: 'Apr 24, 2026', meal: 'Kiley cake, sindhi curry chicken, dal, chicken egg drop soup, chicken tofu hakka noodle, protein shake, Costco protein snacks', protein: 73 },
  { date: 'Apr 23, 2026', meal: 'Work eggs, biryani, 15g shake', protein: 65 },
  { date: 'Apr 21, 2026', meal: 'Work breakfast, chicken and channa dal, Kiley fish, smoothie', protein: 110 },
  { date: 'Apr 20, 2026', meal: 'Kiley cake, chicken and sindhi curry, rotisserie chicken and salad, 15g shake, babybel, 2 eggs, chicken breast slices', protein: 126 },
  { date: 'Apr 19, 2026', meal: 'Milk, chicken tagine, beef cabbage, 2 eggs, chicken breast slices, chickpeas chole, tofu, cheese', protein: 95 },
  { date: 'Apr 18, 2026', meal: '30g shake, sai bhaji with lentils, lox slices, butter chicken', protein: 67 },
  { date: 'Apr 17, 2026', meal: '20g shake, fish tofu stir fry, 2 egg dosa, ham, chicken skewer, lentil soup, green beans', protein: 93 },
  { date: 'Apr 15, 2026', meal: 'Costco chicken skewer, 2 eggs, bean burrito, chicken kebab, hummus', protein: 62 },
  { date: 'Apr 14, 2026', meal: 'Tea with milk, lunch (chicken skewers, black eyed peas, channa dal, chicken lasagna), 5g shake, 20g shake', protein: 63 },
  { date: 'Apr 13, 2026', meal: '2 eggs, lunch (chicken skewers, chilli chicken, tomato curry), 20g shake', protein: 62 },
  { date: 'Apr 12, 2026', meal: 'Ham slices, 2 eggs, bean burrito, chicken tortilla soup, kadai chicken, channa dal, shake', protein: 98 },
  { date: 'Apr 11, 2026', meal: '2 eggs, turkey deli slices, butter chicken, dal, chicken spaghetti, shake', protein: 75 },
  { date: 'Apr 10, 2026', meal: '30g shake, work egg burrito, fried chicken, tuna sushi', protein: 75 },
  { date: 'Apr 9, 2026', meal: '2 eggs, cooked lentils, tofu, Costco chicken skewers, Costco poke', protein: 104 },
  { date: 'Apr 8, 2026', meal: '30g shake, cooked lentils, turkey deli slice, tofu', protein: 72 },
  { date: 'Apr 7, 2026', meal: 'Turkey breast slices, chicken noodle soup, prosciutto sandwich, chicken sandwich, 30g work breakfast, 30g shake', protein: 108 },
  { date: 'Apr 6, 2026', meal: '30g shake, 2 eggs, bagel, turkey slices, PCC dinner', protein: 87 },
  { date: 'Apr 5, 2026', meal: 'TVP, 2 eggs, bacon strips, 4 Costco chicken skewers, 30g shake, shrimp, turkey slices', protein: 129 },
  { date: 'Apr 4, 2026', meal: 'Costco chicken skewers, Greek yogurt, beef lasagna, Kiley cake, halibut ceviche', protein: 107 },
  { date: 'Apr 3, 2026', meal: '2 eggs, shredded cheese, TVP, egg drop soup, tofu shirataki noodles, bacon strips, Greek yogurt', protein: 68 },
  { date: 'Apr 2, 2026', meal: '30g omelet, Costco pizza slices, cupcakes, 30g shake', protein: 88 },
  { date: 'Apr 1, 2026', meal: '30g shake, Kiley cake, shrimp, turkey slices, Costco cheese lasagna, sausage slices, cheese slice', protein: 102 },
  { date: 'Mar 31, 2026', meal: '2x 2-egg omelet with beans, tofu, Kiley cake, egg drop soup (1 egg), fried chicken', protein: 96 },
  { date: 'Mar 30, 2026', meal: '2.5 eggs, bacon strips, Costco chicken skewers, edamame, soy milk, 30g shake, tofu cubes, cheese lasagna, turkey deli slices', protein: 117 },
  { date: 'Mar 29, 2026', meal: '2.5 eggs, 30g shake, bacon strips, shrimp, sausage slices, green beans, Kiley cake', protein: 91 },
  { date: 'Mar 28, 2026', meal: 'Costco chicken skewer, turkey slices, black bean pureed dip, lasagna dinner with cheese', protein: 48 },
  { date: 'Mar 27, 2026', meal: '30g shake, two chicken skewers, milk, elk patty', protein: 84 },
  { date: 'Mar 26, 2026', meal: 'Costco grilled chicken skewers, 2 eggs, turkey deli slices, toast', protein: 79 },
  { date: 'Mar 25, 2026', meal: '30g shake, tuna poke, Kiley cake, turkey deli meat, 2 eggs, chicken shawarma, bagel and cream cheese', protein: 128 },
  { date: 'Mar 24, 2026', meal: '30g shake, tuna, Costco meatballs, high protein cake, turkey slices, grilled chicken shawarma, milk, 1 egg, high protein bagel', protein: 161 },
  { date: 'Mar 23, 2026', meal: 'High protein cake, sausage, 2 fried eggs, Greek yogurt bagel homemade, lox, shrimp, toast, whipped cream cheese', protein: 86 },
  { date: 'Mar 22, 2026', meal: '30g shake, Cobb salad (turkey & 2 eggs), sausage, milk, Kiley cake, shrimp', protein: 93 },
  { date: 'Mar 21, 2026', meal: 'Chinese food, 20g shake, Greek yogurt, milk, Kiley cake', protein: 80 },
  { date: 'Mar 20, 2026', meal: '20g shake, salmon, grilled chicken burger, 2 eggs, lox, tofu & rice', protein: 89 },
  { date: 'Mar 19, 2026', meal: 'Costco meatballs, hummus, Kiley cake', protein: 51 },
  { date: 'Mar 18, 2026', meal: '30g shake, hummus, 2 boiled eggs, Kiley cake', protein: 69 },
  { date: 'Mar 17, 2026', meal: 'Fish & okra (dinner), hummus, 2 eggs, Greek yogurt (dessert), Kiley cake', protein: 82 },
  { date: 'Mar 16, 2026', meal: 'Kebab, chicken soup, smoothie, Kiley cake & milk, turkey & broccoli bread, salmon', protein: 92 },
  { date: 'Mar 15, 2026', meal: 'Chicken rice (lunch), chicken rice (late lunch)', protein: 60 },
  { date: 'Mar 14, 2026', meal: '30g shake, marinated chicken, fried fish (lunch out)', protein: 80 },
  { date: 'Mar 13, 2026', meal: 'Work omelet, work grilled chicken salad, Greek yogurt, turkey sandwich, chicken, kebab, soup, smoothie, Kiley cake & milk, turkey & broccoli bread, salmon', protein: 123 },
  { date: 'Mar 12, 2026', meal: 'Chicken breast, beef kabobs, 2 eggs, pita, turkey deli meat, tomato soup w/ cottage cheese, hummus, kale & cabbage salad, milk', protein: 120 },
  { date: 'Mar 11, 2026', meal: 'Lunch (beef soup, fish balls, protein tortilla), poke dinner, chicken tahini on broccoli bread, beef kabobs, milk', protein: 118 },
  { date: 'Mar 10, 2026', meal: 'Chicken taco salad (work), tomato soup & quesadilla, rotisserie chicken, milk, Kiley cake, Greek yogurt', protein: 114 },
  { date: 'Mar 9, 2026', meal: 'Beef tortilla soup, chicken & rice, milk', protein: 71 },
  { date: 'Mar 8, 2026', meal: '30g shake, salmon, 2 eggs, milk', protein: 81 },
  { date: 'Mar 6, 2026', meal: 'Korean dinner (tofu, fish cake, chicken), milk, 2 eggs, turkey deli meat, cream cheese', protein: 55 },
  { date: 'Feb 18, 2026', meal: '30g shake, shirataki w/ tofu & chicken, lasagna, chicken, 15g shake, 2 eggs, Kiley cake', protein: 156 },
  { date: 'Feb 17, 2026', meal: 'Chicken tikka (breast + thigh), lasagna, salmon poke, Kiley cake, cheese', protein: 106 },
  { date: 'Feb 16, 2026', meal: '30g shake, chicken tenders, lasagna, 2 eggs, milk, Kiley cake, cottage cheese', protein: 121 },
  { date: 'Feb 15, 2026', meal: '30g shake, Greek yogurt, milk, chicken tenders, 2 eggs, toast, sausage patty, pate, tofu', protein: 116 },
  { date: 'Feb 14, 2026', meal: 'Tlayuda (steak & chorizo), 30g shake, 2 eggs, chicken tender, toast, pate, Babybel cheese', protein: 107 },
  { date: 'Feb 13, 2026', meal: 'Lobster tails, 30g shake, chicken tenders, kidney beans, milk, Kiley cake, toast', protein: 135 },
  { date: 'Feb 12, 2026', meal: '30g shake, Costco chicken skewers, 2 eggs, pastrami lox, turkey bacon, soy milk, kidney beans, tofu', protein: 102 },
  { date: 'Feb 11, 2026', meal: '30g shake, Costco chicken skewers, Daring wings, milk, Kiley cake, 1 egg, Greek yogurt, tofu', protein: 103 },
  { date: 'Feb 10, 2026', meal: 'Ground taco beef, 30g shake, chicken tenders, 2 eggs, bread, buffalo wings, hummus, yogurt/cottage cheese dressing, milk', protein: 126 },
  { date: 'Feb 9, 2026', meal: 'Chicken tenders, 30g shake, buffalo wings, Greek yogurt, saba fish, Kiley cake, 1 egg, bread, milk, cottage cheese, tofu', protein: 142 },
  { date: 'Feb 8, 2026', meal: '30g shake, chicken tenders, 3 eggs, salmon, lox, chicken cubes, bread, cottage cheese', protein: 121 },
  { date: 'Feb 7, 2026', meal: 'Shredded beef, sashimi, 30g shake, lentil & quinoa', protein: 112 },
  { date: 'Feb 6, 2026', meal: 'Sashimi dinner, 30g shake, 2 eggs, milk, Kiley cake, soft tofu', protein: 97 },
  { date: 'Feb 5, 2026', meal: '30g shake, 2 eggs, turkey bacon, turkey deli slices, milk, Kiley cake, soft tofu, chocolate treat', protein: 89 },
  { date: 'Feb 4, 2026', meal: '30g shake, turkey deli slices, 2 eggs, chicken Alfredo, chicken taco meat, milk, Kiley cake, soft tofu, dessert', protein: 101 },
  { date: 'Feb 3, 2026', meal: 'Salmon poke, 30g shake, 2 eggs, Kiley cake, milk, Mexican beans, soft tofu, cooked lentils, turkey slices', protein: 121 },
  { date: 'Feb 2, 2026', meal: '30g shake, chicken taco meat, 2 eggs, turkey deli slices, channa dal, milk, Kiley cake, lox, Mexican beans, tofu cubes', protein: 124 },
  { date: 'Feb 1, 2026', meal: 'Chicken tinga, grilled chicken, cooked channa dal, 15g shake, 2 eggs, refried beans', protein: 100 },
  { date: 'Jan 31, 2026', meal: '25g shake, 2 eggs, breakfast sausage, black lentil dal, paneer, tofu', protein: 68 },
  { date: 'Jan 30, 2026', meal: 'Halibut ceviche, lox, cooked channa dal, milk, egg drop soup', protein: 57 },
  { date: 'Jan 29, 2026', meal: '30g shake, chicken deli slices, TVP, ham, 2 eggs, high protein pasta, lentil salad wrap, tofu chorizo, beans', protein: 126 },
  { date: 'Jan 28, 2026', meal: 'Turkey bacon, TVP, salmon chowder, 2 eggs, high protein pasta, imitation crab, Kiley cake, channa dal, soyrizo, Mexican beans, tofu cubes', protein: 120 },
  { date: 'Jan 27, 2026', meal: '2 eggs, milk, pasta, TVP, salmon, Kiley cake, 30g shake', protein: 120 },
  { date: 'Jan 26, 2026', meal: 'Milk, chicken, soft tofu, trout, Kiley cake, 30g shake', protein: 102 },
  { date: 'Jan 25, 2026', meal: '2 eggs, chicken, chicken meatballs, milk, Ethiopian lentils, Ethiopian fake beef, 30g shake', protein: 130 },
  { date: 'Jan 24, 2026', meal: '1.5 eggs, 9 mussels, trout, chicken bowl, cottage cheese, lox slices, imitation crab, 30g shake', protein: 101 },
  { date: 'Jan 23, 2026', meal: '2 eggs, 30g shake, sashimi, cooked beans, pulled pork, chicken breast, imitation crab', protein: 125 },
  { date: 'Jan 22, 2026', meal: 'Chicken rice, 30g shake, sushi', protein: 90 },
  { date: 'Jan 21, 2026', meal: '2 eggs, pulled pork, beans, milk, chicken rice', protein: 70 },
  { date: 'Jan 20, 2026', meal: '30g breakfast work omelet, lox slices, chicken rice, 30g shake', protein: 96 },
  { date: 'Jan 19, 2026', meal: '2 eggs, milk, 30g shake, salmon', protein: 84 },
  { date: 'Jan 18, 2026', meal: '30g chicken soup, 30g shake, kachos (black beans, soy chorizo, cheddar cheese)', protein: 82 },
  { date: 'Jan 17, 2026', meal: '30g shake, 2 eggs, Korean chicken, pulled chicken, Greek yogurt, 10 shrimp', protein: 119 },
  { date: 'Jan 16, 2026', meal: '2 eggs, fried chicken, goat, cooked lentils, hummus, tabouli, Kiley cake, Greek yogurt, pork rib, chicken skewer, chickpeas, peas, ice cream', protein: 136 },
  { date: 'Jan 15, 2026', meal: '2 eggs with beans omelet, 30g shake, soy milk, half & half, shredded cheese, goat, pulled chicken', protein: 112 },
  { date: 'Jan 14, 2026', meal: 'Milk, Greek yogurt, 4 shrimp, chicken dumplings, mac and cheese, salmon, 2 eggs, pulled beef', protein: 103 },
  { date: 'Jan 13, 2026', meal: '2 egg omelet with beans, tofu chorizo, ham (work omelet), chicken, carne asada, 30g shake, Greek yogurt, half Kiley cake, half milk from yesterday', protein: 132 },
  { date: 'Jan 12, 2026', meal: 'Goat curry, soy meat, 30g shake, half Kiley cake, fat-free yogurt, turkey deli slices, 2 eggs, pulled chicken, pulled pork, half cup milk', protein: 129 },
  { date: 'Jan 11, 2026', meal: 'Beef birria, 30g shake, cooked lentils, salmon, 3 shrimp', protein: 94 },
  { date: 'Jan 10, 2026', meal: '2 eggs, turkey slices, cooked lentils, pork pozole soup, 30g shake, milk, Kiley cake', protein: 109 },
  { date: 'Jan 9, 2026', meal: '3 eggs, turkey deli slices, cooked lentils, Kiley cake, 30g shake, soy milk', protein: 92 },
  { date: 'Jan 8, 2026', meal: 'Egg white omelet with black beans and tofu, work chicken salad, chicken soup, mozzarella, buffalo cheese', protein: 104 },
  { date: 'Jan 7, 2026', meal: '2 eggs, breakfast sausage, 30g shake, chicken tinga, milk, Kiley cake, turkey deli slices, mozzarella cheese', protein: 113 },
  { date: 'Jan 6, 2026', meal: 'Work salad bar, Kiley cake, 6 shrimp, chicken breast, Greek yogurt, 30g shake, milk', protein: 111 },
  { date: 'Jan 5, 2026', meal: '2 eggs with crumbled tofu omelet, beans, work salad bar (pulled chicken, lentils, cottage cheese, tofu cubes), 30g shake, Greek yogurt, chicken breast, chicken leg and thigh, hummus, salmon, cooked lentils', protein: 183 },
  { date: 'Jan 4, 2026', meal: '30g shake, 2 eggs, breakfast sausage, whole chicken leg and thigh, Greek yogurt, 1.5 cups milk, half cup cooked lentils', protein: 123 },
  { date: 'Jan 3, 2026', meal: '2 eggs, Mexican beans, chicken skewers, shrimp, tofu rice balls, pulled pork, chicken tikka masala, fried chicken', protein: 126 },
  { date: 'Jan 2, 2026', meal: 'Eggs, tofu rolls, halibut ceviche, peanuts, fish, shake', protein: 105 },
  { date: 'Jan 1, 2026', meal: 'Skewers, shrimp, sushi, tofu maki, bread', protein: 70 },
  { date: 'Dec 30, 2025', meal: 'Impossible ground, eggs, beef, salmon, milk, bread', protein: 104 },
  { date: 'Dec 29, 2025', meal: 'Shake, tuna, chicken salad/breast, tofu salad, pancake, milk', protein: 180 },
  { date: 'Dec 28, 2025', meal: 'Shake, Alfredo, turkey, taco, beans, eggs', protein: 80 },
  { date: 'Dec 27, 2025', meal: 'Shake, turkey, shrimp+tofu Pad Thai, eggnog', protein: 75 },
  { date: 'Dec 26, 2025', meal: 'Eggs, milk, hummus', protein: 27 },
  { date: 'Dec 25, 2025', meal: 'Bacon, eggs, milk, protein pancake, chicken Alfredo, deli sandwich, salmon', protein: 129 },
  { date: 'Dec 24, 2025', meal: 'Milk, yogurt, eggs, shrimp+tofu, ice cream, turkey bacon', protein: 99 },
  { date: 'Dec 23, 2025', meal: 'Shake, tacos, chorizo, wings', protein: 145 },
  { date: 'Dec 22, 2025', meal: 'Coffee milk mix, eggs, dal+fish, shake', protein: 88 },
  { date: 'Dec 21, 2025', meal: 'Cobb salad, shake, soups, milk, rice', protein: 101 },
  { date: 'Dec 20, 2025', meal: 'Eggs, shake, beef, shrimp', protein: 108 },
  { date: 'Dec 19, 2025', meal: 'Eggs, chicken tostada, fish+tofu soup', protein: 82 },
  { date: 'Dec 18, 2025', meal: 'MOD pizza + protein shake', protein: 100 },
  { date: 'Dec 17, 2025', meal: 'Mixed meals, chicken-heavy', protein: 114 },
  { date: 'Dec 16, 2025', meal: 'Omelet, soup, protein adds', protein: 122 },
  { date: 'Dec 15, 2025', meal: 'Mung dal, salmon, ice cream', protein: 107 },
]

const PROTEIN_LOG_HEADERS = ['Date', 'Meal', 'Protein (g)']
const tableRows = entries.map(e => [parseDate(e.date), e.meal, String(e.protein)])
const logContent = `# Protein Log\n\n${serializeTable(PROTEIN_LOG_HEADERS, tableRows)}\n`
fs.writeFileSync(path.join(outFolder, 'protein-log.md'), logContent, 'utf8')
console.log(`Wrote protein-log.md (${tableRows.length} rows)`)

// ── systems.md ────────────────────────────────────────────────────────────────
const systemsContent = `# Systems

## ✅ Success Systems

### 🛒 Grocery Shop by Cuisine Diversity
Shop by cuisine to prevent food boredom and mix flavors naturally.
- **Japanese:** Sashimi, edamame, imitation crab
- **Mexican:** Pulled chicken, soyrizo, beans (black, pinto)
- **Asian:** Boiled broccolini, chicken crisps, tofu (firm, fried), fish cakes
- **Indian:** Dal, tandoori chicken, raita
- **Italian/Mediterranean:** White beans, chickpeas, anchovies, sardines
- **Korean:** Grilled chicken bulgogi
- **Middle Eastern:** Hummus, falafel, shawarma chicken, labneh
- **American Staples:** Eggs, rotisserie chicken, Greek yogurt, cottage cheese, turkey/chicken deli slices, protein shakes/powder, canned tuna/salmon

### 🍕 Pizza Craving Fix
Cheese on high-protein tortilla with beef kebab filling. Satisfies pizza craving with ~40g protein.

### 🏋️ Wandering Day Protocol
Out all day? Pack protein shake as insurance.

### 🔄 Rotisserie Chicken Backup
Making a veg meal? Buy rotisserie chicken every 2 weeks. Zero cooking required.

### 🍳 Work Day Double Stack
Omelet before work + work salad bar = two reliable protein hits.

### 🍮 Dessert Protein Swap
Greek yogurt with nuts as dessert. Sweet tooth + 20-25g protein.

## ⚠️ Failure Systems

### 🍽️ Restaurant Trap: Hungry + Friends Already Ordered
Food's sitting there, you're starving. Recipe for poor choices.
**Fix:**
- Bring tupperware to portion immediately
- Order additional protein that pairs with their food
- Drink water while waiting to stabilize hunger

### 🥘 Potluck at Friend's House
Unlimited tasty food when you arrive hungry = protein goals gone.
**Fix:**
- Have a smoothie (25-30g protein) before leaving home
- Arrive satiated, not starving
`
fs.writeFileSync(path.join(outFolder, 'systems.md'), systemsContent, 'utf8')
console.log('Wrote systems.md')

// ── goals.md ──────────────────────────────────────────────────────────────────
const GOALS_HEADERS = ['Nutrient', 'Target', 'Notes']
const goalsRows = [['Protein', '100 g', 'Daily protein goal']]
const goalsContent = `# Daily Nutrition Goals\n\n${serializeTable(GOALS_HEADERS, goalsRows)}\n`
fs.writeFileSync(path.join(outFolder, 'goals.md'), goalsContent, 'utf8')
console.log('Wrote goals.md')

console.log(`\nDone! Files written to: ${outFolder}`)
