import React, { useState, useEffect } from 'react';
import { TrendingUp, Calendar, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';

export default function ProteinTracker() {
  const [todaysPlan, setTodaysPlan] = useState('');
  const [plannedProtein, setPlannedProtein] = useState(0);
  const [planExpanded, setPlanExpanded] = useState(true);
  const [insightsExpanded, setInsightsExpanded] = useState(false);
  const [expandedWeeks, setExpandedWeeks] = useState(new Set());
  const [entries, setEntries] = useState([]);

  const sevenDayAvg = entries.length === 0 ? 0 : Math.round(
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
                      <p><strong>American Staples:</strong> Eggs, rotisserie chicken, Greek yogurt, cottage cheese, turkey/chicken deli slices, protein shakes/powder, canned tuna/salmon, homemade high-protein breads and cakes</p>
                    </div>
                  </div>
                  <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded-lg">
                    <p className="font-medium text-gray-800 text-sm mb-1">🍕 Pizza Craving Fix</p>
                    <p className="text-gray-700 text-xs">Use a high protein tortilla topped with low-fat cheese and lean protein (e.g., ground beef or chicken). Goes well with sautéed greens. Satisfies pizza craving with ~40g protein.</p>
                  </div>
                  <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded-lg">
                    <p className="font-medium text-gray-800 text-sm mb-1">🍗 Hot Bar Strategy</p>
                    <p className="text-gray-700 text-xs">Out running errands? Hit a grocery store hot bar or buffet for easy protein variety.</p>
                  </div>
                  <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded-lg">
                    <p className="font-medium text-gray-800 text-sm mb-1">🥤 Wandering Day Protocol</p>
                    <p className="text-gray-700 text-xs">Out all day? Pack protein shake as insurance.</p>
                  </div>
                  <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded-lg">
                    <p className="font-medium text-gray-800 text-sm mb-1">💃 Fitness Class Shake Hack</p>
                    <p className="text-gray-700 text-xs">Take shake to fitness class. Save some for post-workout sweet cravings.</p>
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
                    <p className="text-gray-700 text-xs">Split cooking duties: one person makes fish, the other makes lentils. Variety without doubling effort. Save leftovers.</p>
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
