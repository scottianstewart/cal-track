"use client";

import { useEffect, useMemo, useState } from "react";
import {
  motion,
  AnimatePresence,
  useSpring,
  useTransform,
  type Variants,
} from "motion/react";

type Meal = {
  name: string;
  cal: number;
  breakdown?: { item: string; calories: number }[];
};
type Day = { meals: Meal[]; weight: number | null };
type Settings = {
  target: number;
  goalWeight: number;
  heightIn: number;
  age: number;
  sex: "male" | "female" | "other";
  activity: number;
};
type Data = {
  settings: Settings;
  days: Record<string, Day>;
};

const STORAGE_KEY = "daily-log-data";
const CAL_PER_LB = 3500;
const MAX_HORIZON_DAYS = 180;

const ACTIVITY_LEVELS = [
  { label: "Sedentary", value: 1.2 },
  { label: "Light", value: 1.375 },
  { label: "Moderate", value: 1.55 },
  { label: "Active", value: 1.725 },
  { label: "Athlete", value: 1.9 },
];

// Mifflin-St Jeor BMR × activity factor → estimated maintenance calories
function tdeeFor(weightLbs: number, s: Settings): number {
  const kg = weightLbs * 0.453592;
  const cm = s.heightIn * 2.54;
  const sexAdj = s.sex === "male" ? 5 : s.sex === "female" ? -161 : -78;
  return (10 * kg + 6.25 * cm - 5 * s.age + sexAdj) * s.activity;
}

const seedData: Data = {
  settings: {
    target: 1880,
    goalWeight: 160,
    heightIn: 70,
    age: 35,
    sex: "male",
    activity: 1.375,
  },
  days: {
    "2026-07-13": {
      meals: [
        { name: "Ham wraps", cal: 345 },
        { name: "Mini pizza", cal: 640 },
      ],
      weight: 178,
    },
    "2026-07-14": {
      meals: [
        { name: "Gnocchi + pasta", cal: 420 },
        { name: "Chicken street tacos", cal: 800 },
      ],
      weight: 179,
    },
    "2026-07-15": {
      meals: [
        { name: "Ham wraps", cal: 345 },
        { name: "Pork chop, baked potato, butter", cal: 740 },
        { name: "Vanilla ice cream, 3 tsp", cal: 65 },
        { name: "Cereal, saltines, cheddar squares", cal: 550 },
      ],
      weight: 180,
    },
    "2026-07-16": {
      meals: [
        { name: "Cold brew, tortilla wraps, ham, cheese, chicken", cal: 745 },
      ],
      weight: 178,
    },
  },
};

const spring = { type: "spring", stiffness: 320, damping: 30 } as const;

const gridVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const panelVariants: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.985 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 260, damping: 26 },
  },
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftDate(dateStr: string, offset: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + offset);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function dayIndex(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d).getTime() / 86400000);
}

function fmtDate(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Date `offset` days after the date string `base`, e.g. "Sep 12"
function fmtOffset(base: string, offset: number): string {
  const [y, m, d] = base.split("-").map(Number);
  return new Date(y, m - 1, d + offset).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function AnimatedNumber({ value }: { value: number }) {
  const springVal = useSpring(value, { stiffness: 90, damping: 22 });
  const display = useTransform(springVal, (v) => Math.round(v).toString());

  useEffect(() => {
    springVal.set(value);
  }, [springVal, value]);

  return <motion.span>{display}</motion.span>;
}

export default function Home() {
  const [data, setData] = useState<Data>(seedData);
  const [loaded, setLoaded] = useState(false);
  const [entryText, setEntryText] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [lastAdded, setLastAdded] = useState<{
    name: string;
    cal: number;
    breakdown: { item: string; calories: number }[];
    confidence: string;
  } | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [editingMeal, setEditingMeal] = useState<{
    index: number;
    name: string;
    cal: string;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // merge so older saved data picks up newly added profile fields
        setData({
          ...seedData,
          ...parsed,
          settings: { ...seedData.settings, ...(parsed.settings ?? {}) },
        });
      }
    } catch {
      // ignore corrupt local data and keep seed
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("save failed", e);
    }
  }, [data, loaded]);

  const today = todayStr();
  const day: Day = data.days[today] ?? { meals: [], weight: null };
  const total = day.meals.reduce((s, m) => s + m.cal, 0);
  const remaining = data.settings.target - total;
  const progress = Math.min(
    Math.max(total / Math.max(data.settings.target, 1), 0),
    1,
  );

  function updateDay(dateStr: string, updater: (d: Day) => Day) {
    setData((prev) => {
      const existing = prev.days[dateStr] ?? { meals: [], weight: null };
      return { ...prev, days: { ...prev.days, [dateStr]: updater(existing) } };
    });
  }

  async function handleAddMeal() {
    const raw = entryText.trim();
    if (!raw || estimating) return;

    setEstimating(true);
    setEntryError(null);
    try {
      const res = await fetch("/api/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw }),
      });
      const json = await res.json();
      if (!res.ok) {
        setEntryError(
          json.error || "Could not get an estimate. Try rephrasing.",
        );
        return;
      }

      updateDay(today, (d) => ({
        ...d,
        meals: [
          ...d.meals,
          { name: json.name, cal: json.calories, breakdown: json.breakdown },
        ],
      }));

      setLastAdded({
        name: json.name,
        cal: json.calories,
        breakdown: json.breakdown || [],
        confidence: json.confidence,
      });

      setEntryText("");
    } catch {
      setEntryError(
        "Could not reach estimator. Check your connection and try again.",
      );
    } finally {
      setEstimating(false);
    }
  }

  function handleWeightChange(val: string) {
    const num = parseFloat(val);
    updateDay(today, (d) => ({ ...d, weight: Number.isNaN(num) ? null : num }));
  }

  const isToday = selectedDate === today;
  const selectedDay: Day = data.days[selectedDate] ?? { meals: [], weight: null };

  function deleteMeal(dateStr: string, index: number) {
    if (editingMeal?.index === index) setEditingMeal(null);
    updateDay(dateStr, (d) => ({
      ...d,
      meals: d.meals.filter((_, i) => i !== index),
    }));
  }

  function startEditMeal(index: number) {
    const meal = selectedDay.meals[index];
    if (!meal) return;
    setEditingMeal({ index, name: meal.name, cal: String(meal.cal) });
  }

  function saveEditMeal() {
    if (!editingMeal) return;
    const cal = parseInt(editingMeal.cal, 10);
    if (!editingMeal.name.trim() || Number.isNaN(cal) || cal < 0) return;
    updateDay(selectedDate, (d) => ({
      ...d,
      meals: d.meals.map((m, i) =>
        i === editingMeal.index
          ? { ...m, name: editingMeal.name.trim(), cal }
          : m,
      ),
    }));
    setEditingMeal(null);
  }

  function navigateDay(offset: number) {
    setEditingMeal(null);
    setSelectedDate((prev) => {
      const next = shiftDate(prev, offset);
      return next > today ? prev : next;
    });
  }

  function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setData((p) => ({ ...p, settings: { ...p.settings, [key]: value } }));
  }

  function setNumericSetting(
    key: "target" | "goalWeight" | "heightIn" | "age",
    raw: string,
  ) {
    const val = parseFloat(raw);
    if (!Number.isNaN(val)) setSetting(key, val);
  }

  const weighedPoints = useMemo(() => {
    return Object.keys(data.days)
      .filter((d) => data.days[d].weight != null)
      .sort()
      .map((d) => ({
        date: d,
        weight: data.days[d].weight as number,
        idx: dayIndex(d),
      }));
  }, [data.days]);

  const recentCalories = useMemo(() => {
    const days = Object.keys(data.days).sort();
    return days.slice(-7).map((d) => ({
      date: d,
      total: data.days[d].meals.reduce((sum, meal) => sum + meal.cal, 0),
    }));
  }, [data.days]);

  const avgLast7 = useMemo(() => {
    if (recentCalories.length === 0) return 0;
    return Math.round(
      recentCalories.reduce((s, d) => s + d.total, 0) / recentCalories.length,
    );
  }, [recentCalories]);

  const trend = useMemo(() => {
    if (weighedPoints.length < 2) return null;
    const n = weighedPoints.length;
    const meanX = weighedPoints.reduce((s, p) => s + p.idx, 0) / n;
    const meanY = weighedPoints.reduce((s, p) => s + p.weight, 0) / n;
    let num = 0;
    let den = 0;
    weighedPoints.forEach((p) => {
      num += (p.idx - meanX) * (p.weight - meanY);
      den += (p.idx - meanX) ** 2;
    });
    const slopePerDay = den === 0 ? 0 : num / den;
    const slopePerWeek = slopePerDay * 7;
    const last = weighedPoints[weighedPoints.length - 1];

    let etaDays: number | null = null;
    if (slopePerDay < -0.01 && last.weight > data.settings.goalWeight) {
      etaDays =
        (last.weight - data.settings.goalWeight) / Math.abs(slopePerDay);
    }

    return { slopePerDay, slopePerWeek, etaDays };
  }, [weighedPoints, data.settings.goalWeight]);

  const projection = useMemo(() => {
    if (weighedPoints.length === 0) return null;

    const s = data.settings;
    const goal = s.goalWeight;
    const last = weighedPoints[weighedPoints.length - 1];

    // Average intake over the last 7 *complete* logged days (today is
    // still in progress, so it would understate what you actually eat)
    const mealDays = Object.keys(data.days)
      .filter((d) => d !== today && data.days[d].meals.length > 0)
      .sort()
      .slice(-7);
    const recentIntake =
      mealDays.length > 0
        ? mealDays.reduce(
            (sum, d) => sum + data.days[d].meals.reduce((x, m) => x + m.cal, 0),
            0,
          ) / mealDays.length
        : null;

    // Both forecasts are energy balance against estimated maintenance
    // (TDEE), simulated day by day so maintenance falls as weight falls.
    // Fixed assumes you eat exactly your daily target; smart uses what
    // you actually ate over the last week.
    const simulate = (intake: number) => {
      const sim = [last.weight];
      let eta: number | null = null;
      let wcur = last.weight;
      for (let d = 1; d <= MAX_HORIZON_DAYS; d++) {
        wcur += (intake - tdeeFor(wcur, s)) / CAL_PER_LB;
        sim.push(wcur);
        if (wcur <= goal) {
          eta = d;
          break;
        }
      }
      return { sim, eta };
    };

    const tdeeNow = tdeeFor(last.weight, s);
    const fixed = simulate(s.target);
    const smart = recentIntake != null ? simulate(recentIntake) : null;

    const horizon = Math.min(
      Math.max(fixed.eta ?? 0, smart?.eta ?? 0, 21),
      MAX_HORIZON_DAYS,
    );

    return {
      simFixed: fixed.sim,
      etaFixed: fixed.eta,
      simSmart: smart?.sim ?? null,
      etaSmart: smart?.eta ?? null,
      horizon,
      fixedRate: (s.target - tdeeNow) / CAL_PER_LB,
      smartRate:
        recentIntake != null ? (recentIntake - tdeeNow) / CAL_PER_LB : null,
      tdee: Math.round(tdeeNow),
      recentIntake: recentIntake == null ? null : Math.round(recentIntake),
    };
  }, [weighedPoints, data.days, data.settings, today]);

  return (
    <main className="app-shell">
      <motion.section
        className="dashboard-grid"
        variants={gridVariants}
        initial="hidden"
        animate="show"
      >
        <motion.article className="panel panel-hero" variants={panelVariants}>
          <div className="panel-head">
            <p className="eyebrow">Today · {fmtDate(today)}</p>
            <h1>Fuel Dashboard</h1>
          </div>

          <div className="hero-stats">
            <div className="stat-cell">
              <p className="stat-label">Consumed</p>
              <p className="stat-value">
                <AnimatedNumber value={total} />
              </p>
            </div>
            <div className="stat-cell">
              <p className="stat-label">Target</p>
              <p className="stat-value small">{data.settings.target}</p>
            </div>
            <div className="stat-cell">
              <p className="stat-label">Status</p>
              <p
                className={`chip ${remaining < 0 ? "chip-over" : "chip-good"}`}
              >
                {remaining < 0 ? (
                  <>
                    <AnimatedNumber value={-remaining} /> over
                  </>
                ) : (
                  <>
                    <AnimatedNumber value={remaining} /> left
                  </>
                )}
              </p>
            </div>
          </div>

          <CalorieGauge progress={progress} over={remaining < 0} />

          <div className="quick-input-row">
            <input
              type="text"
              value={entryText}
              onChange={(e) => {
                setEntryText(e.target.value);
                if (lastAdded) setLastAdded(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleAddMeal()}
              disabled={estimating}
              placeholder="Log a meal in plain English"
              className={`meal-input ${entryError ? "meal-input-error" : ""}`}
            />
            <motion.button
              onClick={handleAddMeal}
              disabled={estimating || !entryText.trim()}
              className="add-btn"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              transition={spring}
            >
              {estimating ? "Estimating…" : "Add"}
            </motion.button>
          </div>

          <p className={`microcopy ${entryError ? "error" : ""}`}>
            {entryError ||
              "AI estimates are directional. Keep logging to improve trend quality."}
          </p>
        </motion.article>

        <motion.article className="panel panel-meals" variants={panelVariants}>
          <div className="panel-title-row">
            <h2>Meals</h2>
            <span>{selectedDay.meals.length} entries</span>
          </div>

          <div className="day-nav">
            <button className="day-nav-btn" onClick={() => navigateDay(-1)} title="Previous day">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button
              className={`day-nav-label ${isToday ? "" : "past"}`}
              onClick={() => setSelectedDate(today)}
              title={isToday ? "Today" : "Jump to today"}
            >
              {isToday ? "Today" : fmtDate(selectedDate)}
            </button>
            <button className="day-nav-btn" onClick={() => navigateDay(1)} disabled={isToday} title="Next day">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>

          <div className="meals-scroll">
            {selectedDay.meals.length === 0 && (
              <p className="empty">{isToday ? "No meals yet today." : "No meals logged."}</p>
            )}
            <AnimatePresence initial={false}>
              {selectedDay.meals.map((m, i) => (
                <motion.div
                  key={`${selectedDate}-${m.name}-${i}`}
                  className="meal-item"
                  layout
                  initial={{ opacity: 0, y: 10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={spring}
                >
                  {editingMeal?.index === i ? (
                    <div className="meal-edit-form">
                      <input
                        className="meal-edit-name"
                        value={editingMeal.name}
                        onChange={(e) =>
                          setEditingMeal({ ...editingMeal, name: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEditMeal();
                          if (e.key === "Escape") setEditingMeal(null);
                        }}
                        autoFocus
                      />
                      <div className="meal-edit-row">
                        <input
                          className="meal-edit-cal"
                          type="number"
                          value={editingMeal.cal}
                          onChange={(e) =>
                            setEditingMeal({ ...editingMeal, cal: e.target.value })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEditMeal();
                            if (e.key === "Escape") setEditingMeal(null);
                          }}
                        />
                        <span className="meal-edit-unit">cal</span>
                        <button className="meal-action-btn save" onClick={saveEditMeal} title="Save">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        </button>
                        <button className="meal-action-btn cancel" onClick={() => setEditingMeal(null)} title="Cancel">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="meal-item-main">
                        <p>{m.name}</p>
                        <div className="meal-item-right">
                          <strong>{m.cal} cal</strong>
                          <div className="meal-actions">
                            <button className="meal-action-btn edit" onClick={() => startEditMeal(i)} title="Edit meal">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                            </button>
                            <button className="meal-action-btn delete" onClick={() => deleteMeal(selectedDate, i)} title="Delete meal">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                            </button>
                          </div>
                        </div>
                      </div>
                      {m.breakdown && m.breakdown.length > 0 && (
                        <div className="meal-breakdown">
                          {m.breakdown.slice(0, 3).map((b, idx) => (
                            <span key={`${b.item}-${idx}`}>
                              {b.item}: {b.calories}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {lastAdded && isToday && (
              <motion.div
                className="toast-card"
                initial={{ opacity: 0, y: 12, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: 8, height: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              >
                <p className="toast-title">Last added: {lastAdded.name}</p>
                <p>
                  {lastAdded.cal} calories · confidence: {lastAdded.confidence}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.article>

        <motion.article
          className="panel panel-calories"
          variants={panelVariants}
        >
          <div className="panel-title-row">
            <h2>7-Day Intake</h2>
            <span>avg {avgLast7}</span>
          </div>
          <CaloriesBarChart
            points={recentCalories}
            target={data.settings.target}
          />
        </motion.article>

        <motion.article className="panel panel-weight" variants={panelVariants}>
          <div className="panel-title-row">
            <h2>Weight Trend</h2>
            <span>goal {data.settings.goalWeight} lbs</span>
          </div>

          <div className="weight-controls">
            <label htmlFor="weight-input">Today</label>
            <input
              id="weight-input"
              type="number"
              step="0.1"
              value={day.weight ?? ""}
              onChange={(e) => handleWeightChange(e.target.value)}
              placeholder="--"
            />
          </div>

          <WeightTrendChart
            points={weighedPoints}
            goal={data.settings.goalWeight}
          />

          <div className="trend-note">
            {!trend && "Add at least two weigh-ins to unlock forecasting."}
            {trend && (
              <>
                <span>
                  {trend.slopePerWeek >= 0 ? "+" : ""}
                  {trend.slopePerWeek.toFixed(2)} lbs/week
                </span>
                <span>
                  {trend.etaDays
                    ? `ETA ${Math.round(trend.etaDays)} days`
                    : "No reliable goal ETA yet"}
                </span>
              </>
            )}
          </div>
        </motion.article>

        <motion.article
          className="panel panel-projection"
          variants={panelVariants}
        >
          <div className="panel-title-row">
            <h2>Goal Projection</h2>
            <span>
              {projection?.etaSmart
                ? `smart eta ${fmtOffset(
                    weighedPoints[weighedPoints.length - 1].date,
                    projection.etaSmart,
                  )}`
                : projection?.etaFixed
                  ? `on target ${fmtOffset(
                      weighedPoints[weighedPoints.length - 1].date,
                      projection.etaFixed,
                    )}`
                  : "no eta yet"}
            </span>
          </div>

          {!projection ? (
            <p className="empty">
              Log a weigh-in to project a completion date.
            </p>
          ) : (
            <>
              <GoalProjectionChart
                points={weighedPoints}
                goal={data.settings.goalWeight}
                proj={projection}
              />
              <div className="proj-legend" aria-hidden="true">
                <span>
                  <i className="key key-actual" /> actual
                </span>
                <span>
                  <i className="key key-fixed" /> fixed · on target
                </span>
                {projection.simSmart && (
                  <span>
                    <i className="key key-smart" /> smart · actual intake
                  </span>
                )}
              </div>
              <div className="trend-note">
                <span>
                  target {data.settings.target} →{" "}
                  {projection.fixedRate >= 0 ? "+" : ""}
                  {(projection.fixedRate * 7).toFixed(2)} lbs/wk
                </span>
                {projection.smartRate != null &&
                projection.recentIntake != null ? (
                  <span>
                    smart {projection.smartRate >= 0 ? "+" : ""}
                    {(projection.smartRate * 7).toFixed(2)} lbs/wk ·{" "}
                    {projection.recentIntake} eaten vs {projection.tdee} burn
                  </span>
                ) : (
                  <span>log meals to unlock the smart forecast</span>
                )}
              </div>
            </>
          )}
        </motion.article>

        <motion.article
          className="panel panel-settings"
          variants={panelVariants}
        >
          <div className="panel-title-row">
            <h2>Settings</h2>
            <span>personal</span>
          </div>

          <div className="settings-grid">
            <label className="field">
              <span>Daily target</span>
              <input
                type="number"
                value={data.settings.target}
                onChange={(e) => setNumericSetting("target", e.target.value)}
              />
            </label>
            <label className="field">
              <span>Goal · lbs</span>
              <input
                type="number"
                value={data.settings.goalWeight}
                onChange={(e) =>
                  setNumericSetting("goalWeight", e.target.value)
                }
              />
            </label>
            <div className="field">
              <span>Height</span>
              <div className="field-row">
                <input
                  type="number"
                  aria-label="Height feet"
                  value={Math.floor(data.settings.heightIn / 12)}
                  onChange={(e) => {
                    const ft = parseFloat(e.target.value);
                    if (!Number.isNaN(ft))
                      setSetting(
                        "heightIn",
                        ft * 12 + (data.settings.heightIn % 12),
                      );
                  }}
                />
                <em>ft</em>
                <input
                  type="number"
                  aria-label="Height inches"
                  value={data.settings.heightIn % 12}
                  onChange={(e) => {
                    const inch = parseFloat(e.target.value);
                    if (!Number.isNaN(inch))
                      setSetting(
                        "heightIn",
                        Math.floor(data.settings.heightIn / 12) * 12 + inch,
                      );
                  }}
                />
                <em>in</em>
              </div>
            </div>
            <label className="field">
              <span>Age</span>
              <input
                type="number"
                value={data.settings.age}
                onChange={(e) => setNumericSetting("age", e.target.value)}
              />
            </label>
            <label className="field">
              <span>Sex</span>
              <select
                value={data.settings.sex}
                onChange={(e) =>
                  setSetting("sex", e.target.value as Settings["sex"])
                }
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="field">
              <span>Activity</span>
              <select
                value={String(data.settings.activity)}
                onChange={(e) =>
                  setSetting("activity", parseFloat(e.target.value))
                }
              >
                {ACTIVITY_LEVELS.map((a) => (
                  <option key={a.value} value={String(a.value)}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {weighedPoints.length > 0 && (
            <p className="microcopy tdee-note">
              est. maintenance ≈{" "}
              {Math.round(
                tdeeFor(
                  weighedPoints[weighedPoints.length - 1].weight,
                  data.settings,
                ),
              )}{" "}
              cal/day at current weight
            </p>
          )}
        </motion.article>
      </motion.section>
    </main>
  );
}

function CalorieGauge({ progress, over }: { progress: number; over: boolean }) {
  const size = 144;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div className="gauge-wrap" aria-label="Calorie progress ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="gauge-track" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className={`gauge-value ${over ? "over" : ""}`}
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - progress) }}
          transition={{ type: "spring", stiffness: 60, damping: 18 }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="gauge-center">
        <strong>
          <AnimatedNumber value={Math.round(progress * 100)} />%
        </strong>
        <span>target</span>
      </div>
    </div>
  );
}

function CaloriesBarChart({
  points,
  target,
}: {
  points: { date: string; total: number }[];
  target: number;
}) {
  if (points.length === 0) return <p className="empty">No history yet.</p>;

  const maxVal = Math.max(target, ...points.map((p) => p.total), 1);
  const overDays = points.filter((p) => p.total > target).length;
  const w = 420;
  const h = 176;
  const padX = 16;
  const padTop = 16;
  const padBottom = 30;
  const innerH = h - padTop - padBottom;
  const band = (w - padX * 2) / points.length;
  const barW = band * 0.58;
  const yFor = (v: number) => padTop + (1 - v / maxVal) * innerH;
  const targetY = yFor(target);
  const baseY = h - padBottom;

  return (
    <div
      className="intake-chart"
      role="img"
      aria-label="Seven day calorie bars"
    >
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        className="intake-svg"
      >
        {[0.25, 0.5, 0.75].map((step) => {
          const y = padTop + (1 - step) * innerH;
          return (
            <line
              key={step}
              x1={padX}
              y1={y}
              x2={w - padX}
              y2={y}
              className="intake-grid"
            />
          );
        })}

        <line
          x1={padX}
          y1={targetY}
          x2={w - padX}
          y2={targetY}
          className="intake-target"
        />
        <text
          x={w - padX}
          y={targetY - 5}
          className="intake-target-text"
          textAnchor="end"
        >
          target {target}
        </text>

        {points.map((p, i) => {
          const cx = padX + i * band + band / 2;
          const x = cx - barW / 2;
          const y = yFor(p.total);
          const barHeight = Math.max(8, baseY - y);
          const isOver = p.total > target;
          const label = new Date(`${p.date}T00:00:00`).toLocaleDateString(
            undefined,
            {
              weekday: "short",
            },
          );

          return (
            <g key={p.date}>
              <motion.rect
                x={x}
                width={barW}
                rx={6}
                className={`intake-bar ${isOver ? "over" : "under"}`}
                initial={{ y: baseY, height: 0 }}
                animate={{ y, height: barHeight }}
                transition={{
                  type: "spring",
                  stiffness: 160,
                  damping: 22,
                  delay: 0.15 + i * 0.05,
                }}
              />
              <motion.text
                x={cx}
                y={y - 6}
                textAnchor="middle"
                className="intake-value"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35 + i * 0.05 }}
              >
                {p.total}
              </motion.text>
              <text
                x={cx}
                y={h - 10}
                textAnchor="middle"
                className="intake-label"
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="intake-meta">
        <span>{overDays} over target</span>
        <span>{points.length - overDays} on/under target</span>
      </div>
    </div>
  );
}

type Projection = {
  simFixed: number[];
  etaFixed: number | null;
  simSmart: number[] | null;
  etaSmart: number | null;
  horizon: number;
  fixedRate: number;
  smartRate: number | null;
  tdee: number;
  recentIntake: number | null;
};

function GoalProjectionChart({
  points,
  goal,
  proj,
}: {
  points: { date: string; weight: number; idx: number }[];
  goal: number;
  proj: Projection;
}) {
  const [hoverT, setHoverT] = useState<number | null>(null);

  const w = 420;
  const h = 232;
  const padL = 34;
  const padR = 30;
  const padT = 14;
  const padB = 24;

  const first = points[0];
  const last = points[points.length - 1];
  const x0 = first.idx;
  const xEnd = last.idx + proj.horizon;
  const span = Math.max(xEnd - x0, 1);

  // Where each projected line stops: its goal crossing, else the horizon
  const tStop = (eta: number | null) =>
    eta != null ? Math.min(last.idx + eta, xEnd) : xEnd;

  const tFixedEnd = tStop(proj.etaFixed);
  const tSmartEnd = tStop(proj.etaSmart);

  // Simulated weight at absolute day t (clamped at goal)
  const simAt = (
    sim: number[] | null,
    t: number,
    tEnd: number,
  ): number | null => {
    if (!sim) return null;
    const i = t - last.idx;
    if (i < 0 || i >= sim.length || t > tEnd) return null;
    return Math.max(goal, sim[i]);
  };

  const visible = (sim: number[] | null) =>
    sim ? sim.slice(0, Math.min(proj.horizon, sim.length - 1) + 1) : null;

  const fixedVisible = visible(proj.simFixed);
  const smartVisible = visible(proj.simSmart);

  const simMin = (vis: number[] | null) =>
    vis ? [Math.max(goal, Math.min(...vis))] : [];

  const yMax =
    Math.max(
      ...points.map((p) => p.weight),
      ...(fixedVisible ?? []),
      ...(smartVisible ?? []),
    ) + 1.5;
  const yMin =
    Math.min(
      goal,
      ...points.map((p) => p.weight),
      ...simMin(fixedVisible),
      ...simMin(smartVisible),
    ) - 1.5;

  const X = (t: number) => padL + ((t - x0) / span) * (w - padL - padR);
  const Y = (v: number) =>
    padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (h - padT - padB);

  const historyPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${X(p.idx)},${Y(p.weight)}`)
    .join(" ");

  const simPath = (vis: number[] | null) =>
    vis
      ? vis
          .map(
            (v, i) =>
              `${i === 0 ? "M" : "L"}${X(last.idx + i)},${Y(Math.max(goal, v))}`,
          )
          .join(" ")
      : null;

  const fixedPath = simPath(fixedVisible);
  const smartPath = simPath(smartVisible);

  // Interpolated actual weight at absolute day t (history range only)
  function actualAt(t: number): number | null {
    if (t < x0 || t > last.idx) return null;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (t >= a.idx && t <= b.idx) {
        const f = (t - a.idx) / Math.max(b.idx - a.idx, 1);
        return a.weight + f * (b.weight - a.weight);
      }
    }
    return last.weight;
  }

  function moveTo(clientX: number, el: SVGSVGElement) {
    const rect = el.getBoundingClientRect();
    const xView = ((clientX - rect.left) / rect.width) * w;
    const t = Math.round(x0 + ((xView - padL) / (w - padL - padR)) * span);
    setHoverT(Math.min(Math.max(t, x0), xEnd));
  }

  const ticks = [0, 1 / 3, 2 / 3, 1].map((f) => Math.round(x0 + f * span));

  const hover =
    hoverT == null
      ? null
      : {
          t: hoverT,
          date: fmtOffset(first.date, hoverT - x0),
          actual: actualAt(hoverT),
          fixed: simAt(proj.simFixed, hoverT, tFixedEnd),
          smart: simAt(proj.simSmart, hoverT, tSmartEnd),
        };
  const hoverPct = hover ? (X(hover.t) / w) * 100 : 0;

  return (
    <div className="proj-wrap">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        className="proj-svg"
        role="img"
        aria-label="Weight projection toward goal with fixed and smart forecasts"
        tabIndex={0}
        onPointerMove={(e) => moveTo(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHoverT(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            const step = e.key === "ArrowRight" ? 1 : -1;
            setHoverT((t) =>
              Math.min(Math.max((t ?? last.idx) + step, x0), xEnd),
            );
          }
          if (e.key === "Escape") setHoverT(null);
        }}
      >
        {/* goal line */}
        <line
          x1={padL}
          y1={Y(goal)}
          x2={w - padR}
          y2={Y(goal)}
          className="goal-line"
        />
        <text x={padL} y={Y(goal) - 5} className="proj-goal-text">
          goal {goal}
        </text>

        {/* today divider */}
        <line
          x1={X(last.idx)}
          y1={padT}
          x2={X(last.idx)}
          y2={h - padB}
          className="proj-today"
        />
        <text
          x={X(last.idx)}
          y={padT - 3}
          textAnchor="middle"
          className="proj-tick-text"
        >
          now
        </text>

        {/* x-axis ticks */}
        {ticks.map((t) => (
          <text
            key={t}
            x={X(t)}
            y={h - 8}
            textAnchor="middle"
            className="proj-tick-text"
          >
            {fmtOffset(first.date, t - x0)}
          </text>
        ))}

        {/* projections */}
        {fixedPath && (
          <motion.path
            d={fixedPath}
            className="proj-line-fixed"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.55 }}
          />
        )}
        {smartPath && (
          <motion.path
            d={smartPath}
            className="proj-line-smart"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.7 }}
          />
        )}

        {/* history */}
        <motion.path
          d={historyPath}
          className="proj-line-actual"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, ease: "easeInOut", delay: 0.15 }}
        />
        {points.map((p) => (
          <circle
            key={p.date}
            cx={X(p.idx)}
            cy={Y(p.weight)}
            r={2.8}
            className="weight-dot"
          />
        ))}

        {/* ETA markers on the goal line */}
        {proj.etaFixed != null && last.idx + proj.etaFixed <= xEnd && (
          <g>
            <circle
              cx={X(last.idx + proj.etaFixed)}
              cy={Y(goal)}
              r={4}
              className="proj-eta proj-eta-fixed"
            />
            <text
              x={X(last.idx + proj.etaFixed)}
              y={Y(goal) + 14}
              textAnchor="middle"
              className="proj-eta-text"
            >
              {fmtOffset(last.date, proj.etaFixed)}
            </text>
          </g>
        )}
        {proj.etaSmart != null && last.idx + proj.etaSmart <= xEnd && (
          <g>
            <circle
              cx={X(last.idx + proj.etaSmart)}
              cy={Y(goal)}
              r={4}
              className="proj-eta proj-eta-smart"
            />
            <text
              x={X(last.idx + proj.etaSmart)}
              y={Y(goal) - 8}
              textAnchor="middle"
              className="proj-eta-text smart"
            >
              {fmtOffset(last.date, proj.etaSmart)}
            </text>
          </g>
        )}

        {/* crosshair */}
        {hover && (
          <g>
            <line
              x1={X(hover.t)}
              y1={padT}
              x2={X(hover.t)}
              y2={h - padB}
              className="proj-crosshair"
            />
            {hover.actual != null && (
              <circle
                cx={X(hover.t)}
                cy={Y(hover.actual)}
                r={3.5}
                className="proj-hover-dot actual"
              />
            )}
            {hover.fixed != null && (
              <circle
                cx={X(hover.t)}
                cy={Y(hover.fixed)}
                r={3.5}
                className="proj-hover-dot fixed"
              />
            )}
            {hover.smart != null && (
              <circle
                cx={X(hover.t)}
                cy={Y(hover.smart)}
                r={3.5}
                className="proj-hover-dot smart"
              />
            )}
          </g>
        )}
      </svg>

      <AnimatePresence>
        {hover && (
          <motion.div
            className="proj-tooltip"
            style={{
              left: `${Math.min(Math.max(hoverPct, 12), 76)}%`,
            }}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            <p className="proj-tooltip-date">{hover.date}</p>
            {hover.actual != null && (
              <p>
                <i className="key key-actual" />
                <strong>{hover.actual.toFixed(1)}</strong> actual
              </p>
            )}
            {hover.fixed != null && (
              <p>
                <i className="key key-fixed" />
                <strong>{hover.fixed.toFixed(1)}</strong> fixed
              </p>
            )}
            {hover.smart != null && (
              <p>
                <i className="key key-smart" />
                <strong>{hover.smart.toFixed(1)}</strong> smart
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function WeightTrendChart({
  points,
  goal,
}: {
  points: { date: string; weight: number; idx: number }[];
  goal: number;
}) {
  if (points.length < 2) {
    return <p className="empty">Not enough weigh-ins for a chart.</p>;
  }

  const w = 360;
  const h = 140;
  const pad = 18;
  const minW = Math.min(goal, ...points.map((p) => p.weight)) - 1;
  const maxW = Math.max(...points.map((p) => p.weight)) + 1;

  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (val: number) =>
    h - pad - ((val - minW) / (maxW - minW || 1)) * (h - pad * 2);

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.weight)}`)
    .join(" ");
  const area = `${path} L ${x(points.length - 1)},${h - pad} L ${x(0)},${h - pad} Z`;
  const goalY = y(goal);

  return (
    <svg
      className="weight-svg"
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
    >
      <defs>
        <linearGradient id="weight-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255, 243, 18, 0.18)" />
          <stop offset="100%" stopColor="rgba(255, 243, 18, 0)" />
        </linearGradient>
      </defs>
      <line x1={pad} y1={goalY} x2={w - pad} y2={goalY} className="goal-line" />
      <motion.path
        d={area}
        className="weight-area"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.5 }}
      />
      <motion.path
        d={path}
        className="weight-line"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: "easeInOut", delay: 0.2 }}
      />
      {points.map((p, i) => (
        <motion.circle
          key={`${p.date}-${i}`}
          cx={x(i)}
          cy={y(p.weight)}
          r={3.5}
          className="weight-dot"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 20,
            delay: 0.3 + (i / points.length) * 0.6,
          }}
        />
      ))}
    </svg>
  );
}
