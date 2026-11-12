import { addDays } from "../lib/cutEngine";
import Icon from "./Icon";

export default function DateNavigation({
  date,
  currentDate,
  startDate,
  onChange,
}) {
  const isToday = date === currentDate;
  return (
    <div className="date-nav">
      <button
        className="icon-button"
        aria-label="Previous day"
        disabled={date <= startDate}
        onClick={() => onChange(addDays(date, -1))}
      >
        <Icon name="chevronLeft" />
      </button>
      <div className="date-center">
        <h1>{isToday ? "Today" : "Daily log"}</h1>
        <input
          aria-label="Viewing day"
          type="date"
          min={startDate <= currentDate ? startDate : undefined}
          max={currentDate}
          value={date}
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value);
          }}
        />
      </div>
      <button
        className="icon-button"
        aria-label="Next day"
        disabled={isToday}
        onClick={() => onChange(addDays(date, 1))}
      >
        <Icon name="chevronRight" />
      </button>
      {!isToday && (
        <button className="back-to-today" onClick={() => onChange(currentDate)}>
          Back to today
        </button>
      )}
    </div>
  );
}
