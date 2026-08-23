import React, {useEffect, useMemo, useState} from 'react'
import api from '../api'

function monthLabel(date){
  return date.toLocaleDateString(undefined,{month:'long',year:'numeric'})
}

function startOfGrid(date){
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const day = first.getDay();
  return new Date(date.getFullYear(), date.getMonth(), 1-day);
}

export default function CalendarView(){
  const [current, setCurrent] = useState(()=>new Date());
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    let alive = true;
    setLoading(true);
    api.get('/posts').then(r=>{
      if(alive) setPosts(Array.isArray(r.data) ? r.data : []);
    }).catch(()=>{
      if(alive) setPosts([]);
    }).finally(()=>{
      if(alive) setLoading(false);
    });
    return ()=>{ alive = false; };
  },[])

  const days = useMemo(()=>{
    const start = startOfGrid(current);
    return Array.from({length:42}).map((_,i)=>{
      const d = new Date(start);
      d.setDate(start.getDate()+i);
      return d;
    });
  },[current])

  const byDate = useMemo(()=>{
    const map = {};
    posts.forEach(post=>{
      if(!post.scheduled_at) return;
      const d = new Date(post.scheduled_at);
      if(Number.isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
      (map[key] ||= []).push(post);
    });
    return map;
  },[posts])

  const goMonth = (delta)=>setCurrent(d=>new Date(d.getFullYear(),d.getMonth()+delta,1));
  const goToday = ()=>setCurrent(new Date());

  return (
    <div className="page calendar">
      <div className="calendar-toolbar">
        <div>
          <h2>Calendar</h2>
          <div className="calendar-subtitle">Scheduled posts by date</div>
        </div>
        <div className="calendar-controls">
          <button type="button" className="btn-secondary" onClick={goToday}>Today</button>
          <button type="button" className="btn-secondary" onClick={()=>goMonth(-1)}>‹</button>
          <strong className="calendar-month">{monthLabel(current)}</strong>
          <button type="button" className="btn-secondary" onClick={()=>goMonth(1)}>›</button>
        </div>
      </div>

      <div className="calendar-weekdays">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><div key={d}>{d}</div>)}
      </div>

      <div className="calendar-grid">
        {days.map(day=>{
          const key = `${day.getFullYear()}-${day.getMonth()+1}-${day.getDate()}`;
          const items = byDate[key] || [];
          const inMonth = day.getMonth() === current.getMonth();
          const isToday = new Date().toDateString() === day.toDateString();
          return (
            <div key={key} className={`calendar-day${inMonth?'':' muted'}${isToday?' today':''}`}>
              <div className="calendar-day-number">{day.getDate()}</div>
              <div className="calendar-items">
                {items.slice(0,4).map(post=>(
                  <button key={post.id} type="button" className={`calendar-item ${post.status?.toLowerCase()||''}`} onClick={()=>window.dispatchEvent(new CustomEvent('editPost',{detail:post}))}>
                    <span>{post.project_name || '(untitled)'}</span>
                    {post.content_type ? <small>{post.content_type}</small> : null}
                  </button>
                ))}
                {items.length > 4 && <div className="calendar-more">+{items.length-4} more</div>}
              </div>
            </div>
          )
        })}
      </div>
      {loading && <div className="calendar-loading">Loading scheduled posts…</div>}
    </div>
  )
}
