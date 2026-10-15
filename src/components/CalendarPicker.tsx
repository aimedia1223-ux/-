import { useState } from 'react';

interface CalendarPickerProps {
  selectedDates: string[];
  onChange: (dates: string[]) => void;
}

export function CalendarPicker({ selectedDates, onChange }: CalendarPickerProps) {
  const [currentDate, setCurrentDate] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const toggleDate = (dateStr: string) => {
    if (selectedDates.includes(dateStr)) {
      onChange(selectedDates.filter(d => d !== dateStr));
    } else {
      onChange([...selectedDates, dateStr]);
    }
  };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const days = [];
  // Fill empty cells for days before the 1st of the month
  for (let i = 0; i < firstDay; i++) {
    days.push(<div key={`empty-${i}`} className="calendar-day empty"></div>);
  }

  // Fill actual days
  for (let i = 1; i <= daysInMonth; i++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    const isSelected = selectedDates.includes(dateStr);
    
    // Check if it's today
    const today = new Date();
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === i;

    days.push(
      <div 
        key={dateStr} 
        className={`calendar-day ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
        onClick={() => toggleDate(dateStr)}
      >
        {i}
      </div>
    );
  }

  const weekDays = ['日', '月', '火', '水', '木', '金', '土'];

  return (
    <div className="calendar-picker">
      <div className="calendar-header">
        <button type="button" className="icon-btn-dark" onClick={prevMonth}>
          <span className="material-symbols-outlined">chevron_left</span>
        </button>
        <span className="calendar-title">{year}年 {month + 1}月</span>
        <button type="button" className="icon-btn-dark" onClick={nextMonth}>
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
      </div>
      
      <div className="calendar-grid">
        {weekDays.map((wd, i) => (
          <div key={wd} className={`calendar-weekday ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}`}>
            {wd}
          </div>
        ))}
        {days}
      </div>

      <style>{`
        .calendar-picker {
          background: white;
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 12px;
          user-select: none;
        }
        .calendar-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .calendar-title {
          font-weight: bold;
          font-size: 15px;
          color: var(--text-main);
        }
        .calendar-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 4px;
        }
        .calendar-weekday {
          text-align: center;
          font-size: 11px;
          font-weight: bold;
          color: var(--text-sub);
          padding-bottom: 8px;
        }
        .calendar-weekday.sun { color: #EF4444; }
        .calendar-weekday.sat { color: #3B82F6; }
        
        .calendar-day {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 36px;
          font-size: 14px;
          border-radius: 50%;
          cursor: pointer;
          color: var(--text-main);
          transition: all 0.2s;
        }
        .calendar-day:not(.empty):hover {
          background: var(--bg-gray);
        }
        .calendar-day.empty {
          cursor: default;
        }
        .calendar-day.today {
          font-weight: bold;
          color: var(--primary);
        }
        .calendar-day.selected {
          background: var(--primary);
          color: white;
          font-weight: bold;
        }
      `}</style>
    </div>
  );
}
