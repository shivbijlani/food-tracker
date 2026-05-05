import React, { useState, useEffect } from 'react';
import { TrendingUp, Calendar, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';

export default function ProteinTracker() {
  const [todaysPlan, setTodaysPlan] = useState('');
  const [plannedProtein, setPlannedProtein] = useState(0);
  const [planExpanded, setPlanExpanded] = useState(true);
  const [insightsExpanded, setInsightsExpanded] = useState(false);
  const [expandedWeeks, setExpandedWeeks] = useState(new Set());
  const [entries, setEntries] = useState([
    { id: 111, date: 'Apr 24, 2026', meal: 'Kiley cake, sindhi curry chicken, dal, chicken egg drop soup, chicken tofu hakka noodle, protein shake, Costco protein snacks', protein: 73, timestamp: 1745712000000 },
    { id: 110, date: 'Apr 23, 2026', meal: 'Work eggs, biryani, 15g shake', protein: 65, timestamp: 1745625600000 },
    { id: 109, date: 'Apr 21, 2026', meal: 'Work breakfast, chicken and channa dal, Kiley fish, smoothie', protein: 110, timestamp: 1745452800000 },
    { id: 106, date: 'Apr 20, 2026', meal: 'Kiley cake, chicken and sindhi curry, rotisserie chicken and salad, 15g shake, babybel, 2 eggs, chicken breast slices', protein: 126, timestamp: 1745366400000 },
    { id: 107, date: 'Apr 19, 2026', meal: 'Milk, chicken tagine, beef cabbage, 2 eggs, chicken breast slices, chickpeas chole, tofu, cheese', protein: 95, timestamp: 1745280000000 },
    { id: 108, date: 'Apr 18, 2026', meal: '30g shake, sai bhaji with lentils, lox slices, butter chicken', protein: 67, timestamp: 1745193600000 },
    { id: 105, date: 'Apr 17, 2026', meal: '20g shake, fish tofu stir fry, 2 egg dosa, ham, chicken skewer, lentil soup, green beans', protein: 93, timestamp: 1745107200000 },
    { id: 104, date: 'Apr 15, 2026', meal: 'Costco chicken skewer, 2 eggs, bean burrito, chicken kebab, hummus', protein: 62, timestamp: 1744934400000 },
    { id: 103, date: 'Apr 14, 2026', meal: 'Tea with milk, lunch (chicken skewers, black eyed peas, channa dal, chicken lasagna), 5g shake, 20g shake', protein: 63, timestamp: 1744848000000 },
    { id: 101, date: 'Apr 13, 2026', meal: '2 eggs, lunch (chicken skewers, chilli chicken, tomato curry), 20g shake', protein: 62, timestamp: 1744761600000 },
    { id: 102, date: 'Apr 12, 2026', meal: 'Ham slices, 2 eggs, bean burrito, chicken tortilla soup, kadai chicken, channa dal, shake', protein: 98, timestamp: 1744675200000 },
    { id: 99, date: 'Apr 11, 2026', meal: '2 eggs, turkey deli slices, butter chicken, dal, chicken spaghetti, shake', protein: 75, timestamp: 1744588800000 },
    { id: 100, date: 'Apr 10, 2026', meal: '30g shake, work egg burrito, fried chicken, tuna sushi', protein: 75, timestamp: 1744502400000 },
    { id: 97, date: 'Apr 9, 2026', meal: '2 eggs, cooked lentils, tofu, Costco chicken skewers, Costco poke', protein: 104, timestamp: 1744416000000 },
    { id: 98, date: 'Apr 8, 2026', meal: '30g shake, cooked lentils, turkey deli slice, tofu', protein: 72, timestamp: 1744329600000 },
    { id: 96, date: 'Apr 7, 2026', meal: 'Turkey breast slices, chicken noodle soup, prosciutto sandwich, chicken sandwich, 30g work breakfast, 30g shake', protein: 108, timestamp: 1744243200000 },
    { id: 95, date: 'Apr 6, 2026', meal: '30g shake, 2 eggs, bagel, turkey slices, PCC dinner', protein: 87, timestamp: 1744156800000 },
    { id: 94, date: 'Apr 5, 2026', meal: 'TVP, 2 eggs, bacon strips, 4 Costco chicken skewers, 30g shake, shrimp, turkey slices', protein: 129, timestamp: 1744070400000 },
    { id: 93, date: 'Apr 4, 2026', meal: 'Costco chicken skewers, Greek yogurt, beef lasagna, Kiley cake, halibut ceviche', protein: 107, timestamp: 1743984000000 },
    { id: 92, date: 'Apr 3, 2026', meal: '2 eggs, shredded cheese, TVP, egg drop soup, tofu shirataki noodles, bacon strips, Greek yogurt', protein: 68, timestamp: 1743897600000 },
    { id: 91, date: 'Apr 2, 2026', meal: '30g omelet, Costco pizza slices, cupcakes, 30g shake', protein: 88, timestamp: 1743811200000 },
    { id: 90, date: 'Apr 1, 2026', meal: '30g shake, Kiley cake, shrimp, turkey slices, Costco cheese lasagna, sausage slices, cheese slice', protein: 102, timestamp: 1743724800000 },
    { id: 89, date: 'Mar 31, 2026', meal: '2x 2-egg omelet with beans, tofu, Kiley cake, egg drop soup (1 egg), fried chicken', protein: 96, timestamp: 1743638400000 },
    { id: 88, date: 'Mar 30, 2026', meal: '2.5 eggs, bacon strips, Costco chicken skewers, edamame, soy milk, 30g shake, tofu cubes, cheese lasagna, turkey deli slices', protein: 117, timestamp: 1743552000000 },
    { id: 87, date: 'Mar 29, 2026', meal: '2.5 eggs, 30g shake, bacon strips, shrimp, sausage slices, green beans, Kiley cake', protein: 91, timestamp: 1743465600000 },
    { id: 86, date: 'Mar 28, 2026', meal: 'Costco chicken skewer, turkey slices, black bean pureed dip, lasagna dinner with cheese', protein: 48, timestamp: 1743379200000 },
    { id: 85, date: 'Mar 27, 2026', meal: '30g shake, two chicken skewers, milk, elk patty', protein: 84, timestamp: 1743292800000 },
    { id: 78, date: 'Mar 26, 2026', meal: 'Costco grilled chicken skewers, 2 eggs, turkey deli slices, toast', protein: 79, timestamp: 1743206400000 },
    { id: 77, date: 'Mar 25, 2026', meal: '30g shake, tuna poke, Kiley cake, turkey deli meat, 2 eggs, chicken shawarma, bagel and cream cheese', protein: 128, timestamp: 1743120000000 },
    { id: 76, date: 'Mar 24, 2026', meal: '30g shake, tuna, Costco meatballs, high protein cake, turkey slices, grilled chicken shawarma, milk, 1 egg, high protein bagel', protein: 161, timestamp: 1743033600000 },
    { id: 84, date: 'Mar 23, 2026', meal: 'High protein cake, sausage, 2 fried eggs, Greek yogurt bagel homemade, lox, shrimp, toast, whipped cream cheese', protein: 86, timestamp: 1742947200000 },
    { id: 83, date: 'Mar 22, 2026', meal: '30g shake, Cobb salad (turkey & 2 eggs), sausage, milk, Kiley cake, shrimp', protein: 93, timestamp: 1742860800000 },
    { id: 82, date: 'Mar 21, 2026', meal: 'Chinese food, 20g shake, Greek yogurt, milk, Kiley cake', protein: 80, timestamp: 1742774400000 },
    { id: 81, date: 'Mar 20, 2026', meal: '20g shake, salmon, grilled chicken burger, 2 eggs, lox, tofu & rice', protein: 89, timestamp: 1742688000000 },
    { id: 80, date: 'Mar 19, 2026', meal: 'Costco meatballs, hummus, Kiley cake', protein: 51, timestamp: 1742601600000 },
    { id: 79, date: 'Mar 18, 2026', meal: '30g shake, hummus, 2 boiled eggs, Kiley cake', protein: 69, timestamp: 1742515200000 },
    { id: 75, date: 'Mar 17, 2026', meal: 'Fish & okra (dinner), hummus, 2 eggs, Greek yogurt (dessert), Kiley cake', protein: 82, timestamp: 1742428800000 },
    { id: 74, date: 'Mar 16, 2026', meal: 'Kebab, puzzette & soup, smoothie, Kiley cake & milk, turkey & broccoli bread, Kiley salmon', protein: 92, timestamp: 1742342400000 },
    { id: 73, date: 'Mar 15, 2026', meal: 'Chicken rice (lunch), chicken rice (late lunch)', protein: 60, timestamp: 1742256000000 },
    { id: 72, date: 'Mar 14, 2026', meal: '30g shake, marinated chicken (Anil\'s house), fried fish (lunch out)', protein: 80, timestamp: 1742169600000 },
    { id: 71, date: 'Mar 13, 2026', meal: 'Work omelet, work grilled chicken salad, Greek yogurt, turkey sandwich, chicken, kebab, puzzette & soup, smoothie, Kiley cake & milk, turkey & broccoli bread, Kiley salmon', protein: 123, timestamp: 1742083200000 },
    { id: 69, date: 'Mar 12, 2026', meal: 'Chicken breast, beef kabobs, 2 eggs, Costco pita, turkey deli meat, tomato soup w/ cottage cheese, hummus, kale & cabbage salad, milk', protein: 120, timestamp: 1741996800000 },
    { id: 70, date: 'Mar 11, 2026', meal: 'Lunch (beef soup, fish balls, prot tortilla), poke dinner, chicken tahini on broccoli bread, beef kabobs, milk', protein: 118, timestamp: 1741910400000 },
    { id: 67, date: 'Mar 10, 2026', meal: 'Chicken taco salad (work), tomato soup & quesadilla, rotisserie chicken, milk, Kiley cake, Greek yogurt', protein: 114, timestamp: 1741824000000 },
    { id: 68, date: 'Mar 9, 2026', meal: 'Beef tortilla soup, chicken & rice, milk', protein: 71, timestamp: 1741737600000 },
    { id: 66, date: 'Mar 8, 2026', meal: '30g shake, salmon, 2 eggs, milk', protein: 81, timestamp: 1741651200000 },
    { id: 65, date: 'Mar 6, 2026', meal: 'Korean dinner (tofu, fish cake, chicken), milk, 2 eggs, turkey deli meat, cream cheese', protein: 55, timestamp: 1741478400000 },
    { id: 64, date: 'Feb 18, 2026', meal: '30g shake, shirataki w/ tofu & chicken, lasagna, chicken, 15g shake, 2 eggs, Kiley cake', protein: 156, timestamp: 1739923200000 },
    { id: 63, date: 'Feb 17, 2026', meal: 'Chicken tikka (1/2 breast + thigh), lasagna, salmon poke, Kiley cake, cheese', protein: 106, timestamp: 1739836800000 },
    { id: 62, date: 'Feb 16, 2026', meal: '30g shake, chicken tenders, lasagna, 2 eggs, milk, Kiley cake, cottage cheese', protein: 121, timestamp: 1739750400000 },
    { id: 61, date: 'Feb 15, 2026', meal: '30g shake, Greek yogurt, milk, chicken tenders, 2 eggs, toast, sausage patty, pâté, tofu', protein: 116, timestamp: 1739664000000 },
    { id: 60, date: 'Feb 14, 2026', meal: 'Tlayuda (steak & chorizo), 30g shake, 2 eggs, chicken tender, toast, pâté, Babybel cheese', protein: 107, timestamp: 1739577600000 },
    { id: 59, date: 'Feb 13, 2026', meal: 'Lobster tails, 30g shake, chicken tenders, kidney beans, milk, Kiley cake, toast', protein: 135, timestamp: 1739491200000 },
    { id: 58, date: 'Feb 12, 2026', meal: '30g shake, Costco chicken skewers, 2 eggs, pastrami lox, turkey bacon, soy milk, kidney beans, tofu', protein: 102, timestamp: 1739404800000 },
    { id: 57, date: 'Feb 11, 2026', meal: '30g shake, Costco chicken skewers, Daring wings, milk, Kiley cake, 1 egg, Greek yogurt, tofu', protein: 103, timestamp: 1739318400000 },
    { id: 56, date: 'Feb 10, 2026', meal: 'Ground taco beef, 30g shake, chicken tenders, 2 eggs, bread, buffalo wings, hummus, yogurt/cottage cheese dressing, milk', protein: 126, timestamp: 1739232000000 },
    { id: 55, date: 'Feb 9, 2026', meal: 'Chicken tenders, 30g shake, buffalo wings, Greek yogurt, saba fish, Kiley cake, 1 egg, bread, milk, cottage cheese, tofu', protein: 142, timestamp: 1739145600000 },
    { id: 54, date: 'Feb 8, 2026', meal: '30g shake, chicken tenders, 3 eggs, salmon, lox, chicken cubes, bread, cottage cheese', protein: 121, timestamp: 1739059200000 },
    { id: 53, date: 'Feb 7, 2026', meal: 'Shredded beef, sashimi, 30g shake, lentil & quinoa', protein: 112, timestamp: 1738972800000 },
    { id: 52, date: 'Feb 6, 2026', meal: 'Sashimi dinner, 30g shake, 2 eggs, milk, Kiley cake, soft tofu', protein: 97, timestamp: 1738886400000 },
    { id: 51, date: 'Feb 5, 2026', meal: '30g shake, 2 eggs, turkey bacon, turkey deli slices, milk, Kiley cake, soft tofu, chocolate treat', protein: 89, timestamp: 1738800000000 },
    { id: 50, date: 'Feb 4, 2026', meal: '30g shake, turkey deli slices, 2 eggs, chicken Alfredo, chicken taco meat, milk, Kiley cake, soft tofu, dessert', protein: 101, timestamp: 1738713600000 },
    { id: 49, date: 'Feb 3, 2026', meal: 'Salmon poke, 30g shake, 2 eggs, Kiley cake, milk, Mexican beans, soft tofu, cooked lentils, turkey slices', protein: 121, timestamp: 1738627200000 },
    { id: 48, date: 'Feb 2, 2026', meal: '30g shake, chicken taco meat, 2 eggs, turkey deli slices, channa dal, milk, Kiley cake, lox, Mexican beans, tofu cubes', protein: 124, timestamp: 1738540800000 },
    { id: 47, date: 'Feb 1, 2026', meal: 'Chicken tinga, grilled chicken, cooked channa dal, 15g shake, 2 eggs, refried beans', protein: 100, timestamp: 1738454400000 },
    { id: 46, date: 'Jan 31, 2026', meal: '25g shake, 2 eggs, breakfast sausage, black lentil dal, paneer, tofu', protein: 68, timestamp: 1738368000000 },
    { id: 45, date: 'Jan 30, 2026', meal: 'Halibut ceviche, lox, cooked channa dal, milk, egg drop soup', protein: 57, timestamp: 1738281600000 },
    { id: 44, date: 'Jan 29, 2026', meal: '30g shake, chicken deli slices, TVP, ham, 2 eggs, high protein pasta, lentil salad wrap, tofu chorizo, beans', protein: 126, timestamp: 1738195200000 },
    { id: 43, date: 'Jan 28, 2026', meal: 'Turkey bacon, TVP, salmon chowder, 2 eggs, high protein pasta, imitation crab, Kiley cake, channa dal, soyrizo, Mexican beans, tofu cubes', protein: 120, timestamp: 1738108800000 },
    { id: 42, date: 'Jan 27, 2026', meal: '2 eggs, milk, pasta, TVP, salmon, Kiley cake, 30g shake', protein: 120, timestamp: 1738022400000 },
    { id: 41, date: 'Jan 26, 2026', meal: 'Milk, chicken, soft tofu, trout, Kiley cake, 30g shake', protein: 102, timestamp: 1737936000000 },
    { id: 40, date: 'Jan 25, 2026', meal: '2 eggs, chicken, chicken meatballs, milk, Ethiopian lentils, Ethiopian fake beef, 30g shake', protein: 130, timestamp: 1737849600000 },
    { id: 39, date: 'Jan 24, 2026', meal: '1.5 eggs, 9 mussels, trout, chicken bowl, cottage cheese, lox slices, imitation crab, 30g shake', protein: 101, timestamp: 1737763200000 },
    { id: 38, date: 'Jan 23, 2026', meal: '2 eggs, 30g shake, sashimi, cooked beans, pulled pork, chicken breast, imitation crab', protein: 125, timestamp: 1737676800000 },
    { id: 37, date: 'Jan 22, 2026', meal: 'Chicken rice, 30g shake, sushi', protein: 90, timestamp: 1737590400000 },
    { id: 36, date: 'Jan 21, 2026', meal: '2 eggs, pulled pork, beans, milk, chicken rice', protein: 70, timestamp: 1737504000000 },
    { id: 35, date: 'Jan 20, 2026', meal: '30g breakfast work omelet, lox slices, chicken rice, 30g shake', protein: 96, timestamp: 1737417600000 },
    { id: 34, date: 'Jan 19, 2026', meal: '2 eggs, milk, 30g shake, salmon', protein: 84, timestamp: 1737331200000 },
    { id: 33, date: 'Jan 18, 2026', meal: '30g chicken soup, 30g shake, kachos (black beans, soy chorizo, cheddar cheese)', protein: 82, timestamp: 1737244800000 },
    { id: 32, date: 'Jan 17, 2026', meal: '30g shake, 2 eggs, Korean chicken, pulled chicken, Greek yogurt, 10 shrimp', protein: 119, timestamp: 1737158400000 },
    { id: 31, date: 'Jan 16, 2026', meal: '2 eggs, fried chicken, goat, cooked lentils, hummus, tabouli, Kiley cake, Greek yogurt, pork rib, chicken skewer, chickpeas, peas, ice cream', protein: 136, timestamp: 1737072000000 },
    { id: 30, date: 'Jan 15, 2026', meal: '2 eggs with beans omelet, 30g shake, soy milk, half & half, shredded cheese, goat, pulled chicken', protein: 112, timestamp: 1736985600000 },
    { id: 29, date: 'Jan 14, 2026', meal: 'Milk, Greek yogurt, 4 shrimp, chicken dumplings, mac and cheese, salmon, 2 eggs, pulled beef', protein: 103, timestamp: 1736899200000 },
    { id: 28, date: 'Jan 13, 2026', meal: '2 egg omelet with beans, tofu chorizo, ham (work omelet), chicken, carne asada, 30g shake, Greek yogurt, half Kiley cake, half milk from yesterday', protein: 132, timestamp: 1736812800000 },
    { id: 27, date: 'Jan 12, 2026', meal: 'Goat curry, soy meat, 30g shake, half Kiley cake, fat-free yogurt, turkey deli slices, 2 eggs, pulled chicken, pulled pork, half cup milk', protein: 129, timestamp: 1736726400000 },
    { id: 26, date: 'Jan 11, 2026', meal: 'Beef birria, 30g shake, cooked lentils, salmon, 3 shrimp', protein: 94, timestamp: 1736640000000 },
    { id: 25, date: 'Jan 10, 2026', meal: '2 eggs, turkey slices, cooked lentils, pork pozole soup, 30g shake, milk, Kiley cake', protein: 109, timestamp: 1736553600000 },
    { id: 24, date: 'Jan 9, 2026', meal: '3 eggs, turkey deli slices, cooked lentils, Kiley cake, 30g shake, soy milk', protein: 92, timestamp: 1736467200000 },
    { id: 23, date: 'Jan 8, 2026', meal: 'Egg white omelet with black beans and tofu, work chicken salad, chicken soup, mozzarella, buffalo cheese', protein: 104, timestamp: 1736380800000 },
    { id: 22, date: 'Jan 7, 2026', meal: '2 eggs, breakfast sausage, 30g shake, chicken tinga, milk, Kiley cake, turkey deli slices, mozzarella cheese', protein: 113, timestamp: 1736294400000 },
    { id: 21, date: 'Jan 6, 2026', meal: 'Work salad bar (second half), Kiley cake, 6 shrimp, chicken breast, Greek yogurt, 30g shake, milk', protein: 111, timestamp: 1736208000000 },
    { id: 20, date: 'Jan 5, 2026', meal: '2 eggs with crumbled tofu omelet, beans, work salad bar (first half - pulled chicken, lentils, cottage cheese, tofu cubes), 30g shake, Greek yogurt, chicken breast, chicken leg and thigh, hummus, salmon, cooked lentils', protein: 183, timestamp: 1736121600000 },
    { id: 19, date: 'Jan 4, 2026', meal: '30g shake, 2 eggs, breakfast sausage, whole chicken leg and thigh, Greek yogurt, 1.5 cups milk, half cup cooked lentils', protein: 123, timestamp: 1736035200000 },
    { id: 18, date: 'Jan 3, 2026', meal: '2 eggs, Mexican beans, chicken skewers, shrimp, tofu rice balls, pulled pork, chicken tikka masala, fried chicken', protein: 126, timestamp: 1735948800000 },
    { id: 17, date: 'Jan 2, 2026', meal: 'Eggs, tofu rolls, halibut ceviche, peanuts, fish, shake', protein: 105, timestamp: 1735862400000 },
    { id: 16, date: 'Jan 1, 2026', meal: 'Skewers, shrimp, sushi, tofu maki, bread', protein: 70, timestamp: 1735776000000 },
    { id: 15, date: 'Dec 30, 2025', meal: 'Impossible ground, eggs, beef, salmon, milk, bread', protein: 104, timestamp: 1735603200000 },
    { id: 14, date: 'Dec 29, 2025', meal: 'Shake, tuna, chicken salad/breast, tofu salad, pancake, milk', protein: 180, timestamp: 1735516800000 },
    { id: 13, date: 'Dec 28, 2025', meal: 'Shake, Alfredo, turkey, taco, beans, eggs', protein: 80, timestamp: 1735430400000 },
    { id: 12, date: 'Dec 27, 2025', meal: 'Shake, turkey, shrimp+tofu Pad Thai, eggnog', protein: 75, timestamp: 1735344000000 },
    { id: 11, date: 'Dec 26, 2025', meal: 'Eggs, milk, hummus', protein: 27, timestamp: 1735257600000 },
    { id: 10, date: 'Dec 25, 2025', meal: 'Bacon, eggs, milk, protein pancake, chicken Alfredo, deli sandwich, salmon', protein: 129, timestamp: 1735171200000 },
    { id: 9, date: 'Dec 24, 2025', meal: 'Milk, yogurt, eggs, shrimp+tofu, ice cream, turkey bacon', protein: 99, timestamp: 1735084800000 },
    { id: 8, date: 'Dec 23, 2025', meal: 'Shake, tacos, chorizo, wings', protein: 145, timestamp: 1734998400000 },
    { id: 7, date: 'Dec 22, 2025', meal: 'Coffee milk mix, eggs, dal+fish, shake', protein: 88, timestamp: 1734912000000 },
    { id: 6, date: 'Dec 21, 2025', meal: 'Cobb salad, shake, soups, milk, rice', protein: 101, timestamp: 1734825600000 },
    { id: 5, date: 'Dec 20, 2025', meal: 'Eggs, shake, beef, shrimp', protein: 108, timestamp: 1734739200000 },
    { id: 4, date: 'Dec 19, 2025', meal: 'Eggs, chicken tostada, fish+tofu soup', protein: 82, timestamp: 1734652800000 },
    { id: 3, date: 'Dec 18, 2025', meal: 'MOD pizza + protein shake', protein: 100, timestamp: 1734566400000 },
    { id: 2, date: 'Dec 17, 2025', meal: 'Mixed meals, chicken-heavy', protein: 114, timestamp: 1734480000000 },
    { id: 1, date: 'Dec 16, 2025', meal: 'Omelet, soup, protein adds', protein: 122, timestamp: 1734393600000 },
    { id: 0, date: 'Dec 15, 2025', meal: 'Mung dal, salmon, ice cream', protein: 107, timestamp: 1734307200000 }
  ]);

  const sevenDayAvg = Math.round(
    entries.slice(0, 7).reduce((sum, e) => sum + e.protein, 0) / Math.min(7, entries.length)
  );

  const proteinGoal = Math.round(sevenDayAvg * 1.1);

  // Get today's total protein
  const today = new Date().toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: 'numeric'
  });
  const todaysEntry = entries.find(e => e.date === today);
  const todaysProtein = todaysEntry ? todaysEntry.protein : 0;

  // Calculate time progress (7am to 7pm = 12 hours)
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const startHour = 7;
  const endHour = 19;
  
  let timeProgress = 0;
  if (currentHour < startHour) {
    timeProgress = 0;
  } else if (currentHour >= endHour) {
    timeProgress = 100;
  } else {
    const totalMinutes = (endHour - startHour) * 60;
    const elapsedMinutes = (currentHour - startHour) * 60 + currentMinute;
    timeProgress = Math.round((elapsedMinutes / totalMinutes) * 100);
  }

  const proteinProgress = Math.round((todaysProtein / proteinGoal) * 100);
  const plannedProgress = Math.round(((todaysProtein + plannedProtein) / proteinGoal) * 100);
  const isOnTrack = plannedProgress >= timeProgress;
  const goalLinePosition = 100;

  // Group entries by week (Sunday-Saturday)
  const parseEntryDate = (dateStr) => {
    // dateStr format: "Mar 14, 2026"
    const monthMap = {
      'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
      'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };
    
    const parts = dateStr.split(' ');
    if (parts.length !== 3) return null;
    
    const month = monthMap[parts[0]];
    const day = parseInt(parts[1].replace(',', ''));
    const year = parseInt(parts[2]);
    
    if (month === undefined || isNaN(day) || isNaN(year)) return null;
    
    return new Date(year, month, day);
  };

  const getWeekStart = (dateStr) => {
    const date = parseEntryDate(dateStr);
    if (!date) return null;
    
    const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - dayOfWeek); // Go back to Sunday
    weekStart.setHours(0, 0, 0, 0);
    
    return weekStart;
  };

  const getWeekKey = (dateStr) => {
    const weekStart = getWeekStart(dateStr);
    if (!weekStart) return 'invalid';
    return weekStart.toISOString().split('T')[0];
  };

  const getWeekLabel = (weekKey) => {
    const start = new Date(weekKey + 'T00:00:00');
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  };

  const groupedEntries = {};
  entries.forEach(entry => {
    const weekKey = getWeekKey(entry.date);
    if (!groupedEntries[weekKey]) {
      groupedEntries[weekKey] = {
        label: getWeekLabel(weekKey),
        entries: [],
        total: 0
      };
    }
    groupedEntries[weekKey].entries.push(entry);
    groupedEntries[weekKey].total += entry.protein;
  });

  const weeks = Object.keys(groupedEntries).sort().reverse();
  const currentWeekKey = weeks[0];

  // Initialize current week as expanded
  useEffect(() => {
    if (currentWeekKey) {
      setExpandedWeeks(new Set([currentWeekKey]));
    }
  }, []);

  const toggleWeek = (weekKey) => {
    const newExpanded = new Set(expandedWeeks);
    if (newExpanded.has(weekKey)) {
      newExpanded.delete(weekKey);
    } else {
      newExpanded.add(weekKey);
    }
    setExpandedWeeks(newExpanded);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-2 flex items-center gap-2">
            <TrendingUp className="text-blue-600" />
            Protein Tracker
          </h1>
          <p className="text-gray-600">Tell Claude what you ate in the chat to log it here</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg mb-6">
          <button
            onClick={() => setPlanExpanded(!planExpanded)}
            className="w-full p-6 flex items-center justify-between hover:bg-gray-50 transition-colors rounded-t-2xl"
          >
            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Lightbulb className="text-yellow-600" size={24} />
              Today's Progress
            </h2>
            {planExpanded ? (
              <ChevronUp className="text-gray-600" size={24} />
            ) : (
              <ChevronDown className="text-gray-600" size={24} />
            )}
          </button>
          
          {planExpanded && (
            <div className="px-6 pb-6 space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-gray-700">
                    {todaysProtein}g eaten + {plannedProtein}g planned + {Math.max(0, proteinGoal - todaysProtein - plannedProtein)}g gap
                  </span>
                  <span className="text-sm font-medium text-gray-700">Goal: {proteinGoal}g</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-6 overflow-hidden relative">
                  <div 
                    className={`h-6 rounded-full transition-all absolute left-0 ${
                      proteinProgress >= 100 ? 'bg-green-500' : isOnTrack ? 'bg-green-500' : 'bg-yellow-500'
                    }`}
                    style={{ width: `${Math.min(proteinProgress, 100)}%` }}
                  ></div>
                  <div 
                    className="h-6 bg-purple-300 rounded-full transition-all absolute right-0"
                    style={{ width: `${Math.min(Math.round((plannedProtein / proteinGoal) * 100), 100 - proteinProgress)}%` }}
                  ></div>
                  {proteinProgress < 100 && (
                    <div 
                      className="h-6 w-1 bg-orange-500 transition-all absolute top-0"
                      style={{ left: `${goalLinePosition}%`, transform: 'translateX(-50%)' }}
                      title="Goal"
                    ></div>
                  )}
                  <div 
                    className="h-6 w-1 bg-blue-600 transition-all absolute top-0"
                    style={{ left: `${Math.min(timeProgress, 100)}%`, transform: 'translateX(-50%)' }}
                  ></div>
                </div>
                <div className="flex gap-4 mt-2 text-xs text-gray-600">
                  <span>🟢 Eaten</span>
                  {plannedProtein > 0 && <span>🟣 Planned</span>}
                  <span>🔵 {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                  {proteinProgress < 100 && <span>🟠 Goal</span>}
                </div>
              </div>

              {todaysPlan && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-gray-800">{todaysPlan}</p>
                </div>
              )}
              <p className="text-sm text-gray-600">
                💡 Tell Claude your meal ideas in chat and get suggestions
              </p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-lg mb-6">
          <button
            onClick={() => setInsightsExpanded(!insightsExpanded)}
            className="w-full p-6 flex items-center justify-between hover:bg-gray-50 transition-colors rounded-t-2xl"
          >
            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <TrendingUp className="text-green-600" size={24} />
              Success & Failure Systems
            </h2>
            {insightsExpanded ? (
              <ChevronUp className="text-gray-600" size={24} />
            ) : (
              <ChevronDown className="text-gray-600" size={24} />
            )}
          </button>
          
          {insightsExpanded && (
            <div className="px-6 pb-6 space-y-4">
              <div>
                <h3 className="font-semibold text-green-700 mb-2">✅ Success Systems</h3>
                <div className="space-y-2">
                  <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded-lg">
                    <p className="font-medium text-gray-800 text-sm mb-1">🛒 Grocery Shop by Cuisine Diversity</p>
                    <p className="text-gray-700 text-xs mb-2">Shop by cuisine to prevent food boredom and mix flavors naturally.</p>
                    <div className="text-xs text-gray-700 space-y-1">
                      <p><strong>Japanese:</strong> Sashimi, edamame, imitation crab</p>
                      <p><strong>Mexican:</strong> Pulled chicken, soyrizo, beans (black, pinto)</p>
                      <p><strong>Asian:</strong> Boiled broccolini, chicken crisps, tofu (firm, fried), fish cakes</p>
                      <p><strong>Indian:</strong> Dal, tandoori chicken, raita</p>
                      <p><strong>Italian/Mediterranean:</strong> White beans, chickpeas, anchovies, sardines</p>
                      <p><strong>Korean:</strong> Grilled chicken bulgogi</p>
                      <p><strong>Middle Eastern:</strong> Hummus, falafel, shawarma chicken, labneh</p>
                      <p><strong>American Staples:</strong> Eggs, rotisserie chicken, Greek yogurt, cottage cheese, turkey/chicken deli slices, protein shakes/powder, canned tuna/salmon, Kiley's breads and cakes</p>
                    </div>
                  </div>
                  <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded-lg">
                    <p className="font-medium text-gray-800 text-sm mb-1">🍕 Pizza Craving Fix</p>
                    <p className="text-gray-700 text-xs">Kiley makes cheese on Mission high protein tortilla with beef kebabs filling. Goes well with Swiss chard. Satisfies pizza craving with ~40g protein.</p>
                  </div>
                  <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded-lg">
                    <p className="font-medium text-gray-800 text-sm mb-1">🍗 Whole Foods Hot Bar Strategy</p>
                    <p className="text-gray-700 text-xs">Coming back from Sand Point? Hit Whole Foods buffet for easy protein variety.</p>
                  </div>
                  <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded-lg">
                    <p className="font-medium text-gray-800 text-sm mb-1">🥤 Wandering Day Protocol</p>
                    <p className="text-gray-700 text-xs">Out all day? Pack protein shake as insurance.</p>
                  </div>
                  <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded-lg">
                    <p className="font-medium text-gray-800 text-sm mb-1">💃 Dance Church Shake Hack</p>
                    <p className="text-gray-700 text-xs">Take shake to dance church. Save some for post-dinner sweet cravings.</p>
                  </div>
                  <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded-lg">
                    <p className="font-medium text-gray-800 text-sm mb-1">🐔 Rotisserie Chicken Backup</p>
                    <p className="text-gray-700 text-xs">Making veg meal? Buy rotisserie chicken every 2 weeks. Zero cooking required.</p>
                  </div>
                  <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded-lg">
                    <p className="font-medium text-gray-800 text-sm mb-1">🏢 Work Day Double Stack</p>
                    <p className="text-gray-700 text-xs">Omelet before work + work salad bar = two reliable protein hits.</p>
                  </div>
                  <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded-lg">
                    <p className="font-medium text-gray-800 text-sm mb-1">🏠 Home Cooking Division</p>
                    <p className="text-gray-700 text-xs">Kiley makes fish, you make lentils. Variety without doubling effort. Save leftovers.</p>
                  </div>
                  <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded-lg">
                    <p className="font-medium text-gray-800 text-sm mb-1">🍨 Dessert Protein Swap</p>
                    <p className="text-gray-700 text-xs">Greek yogurt with nuts as dessert. Sweet tooth + 20-25g protein.</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-red-700 mb-2">⚠️ Failure Systems (& How to Fix)</h3>
                <div className="space-y-2">
                  <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded-lg">
                    <p className="font-medium text-gray-800 text-sm mb-1">🍽️ Restaurant Trap: Hungry + Friends Already Ordered</p>
                    <p className="text-gray-700 text-xs mb-2">Food's sitting there, you're starving. Recipe for poor choices.</p>
                    <p className="font-semibold text-gray-800 text-xs mb-1">Fix:</p>
                    <ul className="text-gray-700 text-xs space-y-1 ml-3">
                      <li>• Bring tupperware (always!) to portion control immediately</li>
                      <li>• Have some now, save rest for later - already portioned</li>
                      <li>• Order additional protein that pairs with their food</li>
                      <li>• Drink water while waiting to stabilize hunger</li>
                      <li>• Enjoy healthier option + tastier option in moderation</li>
                    </ul>
                  </div>
                  <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded-lg">
                    <p className="font-medium text-gray-800 text-sm mb-1">🎉 Potluck at Friend's House</p>
                    <p className="text-gray-700 text-xs mb-2">Unlimited tasty food when you arrive hungry = protein goals gone.</p>
                    <p className="font-semibold text-gray-800 text-xs mb-1">Fix:</p>
                    <ul className="text-gray-700 text-xs space-y-1 ml-3">
                      <li>• Have smoothie (25-30g protein) before leaving home</li>
                      <li>• Drink plenty of water before exposure to food</li>
                      <li>• Arrive satiated, not starving - makes protein-first choices easier</li>
                      <li>• You can still enjoy the food, but won't be desperate</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {entries.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <Calendar className="text-blue-600" size={24} />
                Your Meals
              </h2>
              <div className="text-right">
                <p className="text-sm text-gray-600">7-Day Average</p>
                <p className="text-2xl font-bold text-blue-600">{sevenDayAvg}g/day</p>
              </div>
            </div>
            
            <div className="space-y-3">
              {weeks.map((weekKey) => {
                const week = groupedEntries[weekKey];
                const isExpanded = expandedWeeks.has(weekKey);
                const weekAvg = Math.round(week.total / week.entries.length);
                
                return (
                  <div key={weekKey}>
                    <button
                      onClick={() => toggleWeek(weekKey)}
                      className="w-full p-3 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-200"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronUp className="text-gray-600" size={18} />
                        ) : (
                          <ChevronDown className="text-gray-600" size={18} />
                        )}
                        <span className="font-medium text-gray-700 text-sm">{week.label}</span>
                        <span className="text-xs text-gray-500">({week.entries.length} days)</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-blue-600">{weekAvg}g/day</p>
                      </div>
                    </button>
                    
                    {isExpanded && (
                      <div className="space-y-2 mt-2 mb-3">
                        {week.entries.map((entry) => (
                          <div
                            key={entry.id}
                            className="border-l-4 border-blue-200 pl-4 py-2 hover:border-blue-400 transition-colors"
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <p className="text-gray-800 text-sm">{entry.meal}</p>
                                <p className="text-xs text-gray-500 mt-1">{entry.date}</p>
                              </div>
                              <div className="text-right ml-4">
                                <p className="text-xl font-bold text-blue-600">{entry.protein}g</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
