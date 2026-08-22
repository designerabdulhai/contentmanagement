import React from 'react'

export default function CalendarView(){
  // Simple month grid stub
  const days = Array.from({length:30}).map((_,i)=>({d:i+1, items:[]}));
  return (
    <div className="page calendar">
      <h2>Calendar</h2>
      <div className="month-grid">
        {days.map(day=> (
          <div key={day.d} className="month-day">
            <div className="day-num">{day.d}</div>
            <div className="day-items">{/* chips would go here*/}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
