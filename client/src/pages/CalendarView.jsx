import React, {useEffect, useMemo, useState} from 'react'
import api from '../api'

const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function monthLabel(date){
  return date.toLocaleDateString(undefined,{month:'long',year:'numeric'});
}

function dateKey(date){
  return `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`;
}

function startOfGrid(date){
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  return new Date(date.getFullYear(), date.getMonth(), 1-first.getDay());
}

function formatTime(value){
  if(!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
}

export default function CalendarView(){
  const [current, setCurrent] = useState(()=>new Date());
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadPosts = ()=>{
    setLoading(true);
    setError('');
    return api.get('/posts')
      .then(r=>setPosts(Array.isArray(r.data) ? r.data : []))
      .catch(()=>{
        setPosts([]);
        setError('Unable to load scheduled posts.');
      })
      .finally(()=>setLoading(false));
  };

  useEffect(()=>{
    let alive = true;
    setLoading(true);
    api.get('/posts').then(r=>{
      if(alive) setPosts(Array.isArray(r.data) ? r.data : []);
    }).catch(()=>{
      if(alive){ setPosts([]); setError('Unable to load scheduled posts.'); }
    }).finally(()=>{
      if(alive) setLoading(false);
    });
    return ()=>{ alive = false; };
  },[]);

  const days = useMemo(()=>{
    const start = startOfGrid(current);
    return Array.from({length:42},(_,i)=>{
      const d = new Date(start);
      d.setDate(start.getDate()+i);
      return d;
    });
  },[current]);

  const byDate = useMemo(()=>{
    const map = {};
    posts.forEach(post=>{
      if(!post?.scheduled_at) return;
      const d = new Date(post.scheduled_at);
      if(Number.isNaN(d.getTime())) return;
      const key = dateKey(d);
      (map[key] ||= []).push(post);
    });
    Object.values(map).forEach(items=>items.sort((a,b)=>String(a.scheduled_at||'').localeCompare(String(b.scheduled_at||''))));
    return map;
  },[posts]);

  const monthPosts = useMemo(()=>posts.filter(post=>{
    if(!post?.scheduled_at) return false;
    const d = new Date(post.scheduled_at);
    return !Number.isNaN(d.getTime()) && d.getFullYear()===current.getFullYear() && d.getMonth()===current.getMonth();
  }),[posts,current]);

  const goMonth = (delta)=>setCurrent(d=>new Date(d.getFullYear(),d.getMonth()+delta,1));
  const goToday = ()=>setCurrent(new Date());

  return (
    <div className="page calendar">
      <div className="calendar-toolbar">
        <div>
          <h2>Calendar View</h2>
          <div className="calendar-subtitle">{monthPosts.length} scheduled {monthPosts.length===1?'post':'posts'} this month</div>
        </div>
        <div className="calendar-controls">
          <button type="button" className="btn-secondary" onClick={goToday}>Today</button>
          <button type="button" className="btn-secondary" onClick={()=>goMonth(-1)} aria-label="Previous month">‹</button>
          <strong className="calendar-month">{monthLabel(current)}</strong>
          <button type="button" className="btn-secondary" onClick={()=>goMonth(1)} aria-label="Next month">›</button>
          <button type="button" className="btn-secondary" onClick={loadPosts}>Refresh</button>
        </div>
      </div>

      {error && <div className="calendar-error">{error}</div>}

      <div className="calendar-weekdays">
        {WEEKDAYS.map(day=><div key={day}>{day}</div>)}
      </div>

      <div className="calendar-grid">
        {days.map(day=>{
          const key = dateKey(day);
          const items = byDate[key] || [];
          const inMonth = day.getMonth() === current.getMonth();
          const isToday = new Date().toDateString() === day.toDateString();
          return (
            <div key={key} className={`calendar-day${inMonth?'':' muted'}${isToday?' today':''}`}>
              <div className="calendar-day-head">
                <div className="calendar-day-number">{day.getDate()}</div>
                {items.length>0 && <span className="calendar-count">{items.length}</span>}
              </div>
              <div className="calendar-items">
                {items.slice(0,5).map(post=>(
                  <button key={post.id} type="button" className={`calendar-item ${post.status?.toLowerCase()||''}`} onClick={()=>window.dispatchEvent(new CustomEvent('editPost',{detail:post}))}>
                    <div className="calendar-item-top">
                      <span className="calendar-item-title">{post.project_name || '(untitled)'}</span>
                      <span className="calendar-item-time">{formatTime(post.scheduled_at)}</span>
                    </div>
                    {post.content_type ? <small>{post.content_type}</small> : null}
                    {post.channel || post.platform ? <small>{[post.channel, post.platform].filter(Boolean).join(' • ')}</small> : null}
                  </button>
                ))}
                {items.length>5 && <div className="calendar-more">+{items.length-5} more</div>}
              </div>
            </div>
          );
        })}
      </div>

      {loading && <div className="calendar-loading">Loading calendar…</div>}
    </div>
  );
}
