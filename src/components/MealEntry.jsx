import { useState } from "react";
import { FOOD_DB, mealFromFood } from "../lib/foodDB";

export default function MealEntry({ onAdd }) {
  const [mode, setMode] = useState("quick"),
    [query, setQuery] = useState(""),
    [foodId, setFoodId] = useState(""),
    [amount, setAmount] = useState("100");
  const [name, setName] = useState(""),
    [calories, setCalories] = useState(""),
    [protein, setProtein] = useState("");
  const [error, setError] = useState("");
  const matches = FOOD_DB.filter((f) =>
    f.name.toLowerCase().includes(query.toLowerCase()),
  );
  const food = FOOD_DB.find((f) => f.id === foodId);
  function add() {
    setError("");
    if (mode === "food") {
      if (
        !food ||
        !Number.isFinite(+amount) ||
        +amount <= 0 ||
        +amount > 10000
      ) {
        setError("Choose a food and enter a valid amount.");
        return;
      }
      onAdd(mealFromFood(food, +amount));
      return;
    }
    if (
      !name.trim() ||
      calories === "" ||
      !Number.isFinite(+calories) ||
      +calories < 0 ||
      +calories > 10000 ||
      !Number.isFinite(+protein) ||
      +protein < 0 ||
      +protein > 1000 ||
      +protein * 4 > +calories + 10
    ) {
      setError(
        "Enter a meal name, valid calories, and protein consistent with those calories.",
      );
      return;
    }
    onAdd({ name: name.trim(), cals: +calories, protein: +protein });
    setName("");
    setCalories("");
    setProtein("");
  }
  return (
    <div className="meal-entry">
      <div className="mode-switch">
        <button
          type="button"
          className={mode === "quick" ? "selected" : ""}
          onClick={() => setMode("quick")}
        >
          Quick entry
        </button>
        <button
          type="button"
          className={mode === "food" ? "selected" : ""}
          onClick={() => setMode("food")}
        >
          Food library
        </button>
      </div>
      {mode === "quick" ? (
        <div className="grid three">
          <label>
            Meal name
            <input
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lunch, snack, recipe…"
            />
          </label>
          <label>
            Calories
            <input
              type="number"
              min="0"
              max="10000"
              value={calories}
              onChange={(e) => setCalories(e.target.value)}
            />
          </label>
          <label>
            Protein · g
            <input
              type="number"
              min="0"
              max="1000"
              step="0.1"
              value={protein}
              onChange={(e) => setProtein(e.target.value)}
              placeholder="0"
            />
          </label>
        </div>
      ) : (
        <>
          <div className="grid three">
            <label>
              Search foods
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setFoodId("");
                }}
                placeholder="Rice, paneer, whey…"
              />
            </label>
            <label>
              Choose food
              <select
                value={foodId}
                onChange={(e) => {
                  setFoodId(e.target.value);
                  const f = FOOD_DB.find((f) => f.id === e.target.value);
                  setAmount(f?.unit === "g" || f?.unit === "ml" ? "100" : "1");
                }}
              >
                <option value="">Select…</option>
                {matches.map((f) => (
                  <option value={f.id} key={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount · {food?.unit || "g"}
              <input
                type="number"
                min="0.1"
                max="10000"
                step="0.1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          </div>
          <p className="muted">
            Use the raw / dry weight unless the food name specifies cooked. Food
            values are estimates; use package values when available.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="notice danger">
          {error}
        </p>
      )}
      <button type="button" onClick={add}>
        + Add food
      </button>
    </div>
  );
}
