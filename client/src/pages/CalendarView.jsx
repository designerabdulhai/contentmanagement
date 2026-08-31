import React, {useEffect, useMemo, useState} from 'react'
import api from '../api'

const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'posted', label: 'Posted' },
];

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

function toDate(value, assumeUtc=false){
  if(!value) return null;
  if(value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  let raw = String(value).trim();
  if(!raw) return null;
  // Database timestamps without timezone are UTC. The scheduled_at value is
  // user-entered local Bangladesh time and must remain local.
  if(assumeUtc && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) raw = raw.replace(' ','T') + 'Z';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatTime(value){
  const d = value instanceof Date ? value : toDate(value);
  return d ? d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) : '';
}

function formatDateTime(value){
  const d = value instanceof Date ? value : toDate(value);
  return d ? d.toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : '';
}

function statusKey(status){
  const s = String(status || '').trim().toLowerCase();
  if(s.includes('upload')) return 'uploaded';
  if(s.includes('post') || s.includes('publish')) return 'posted';
  if(s.includes('sched')) return 'scheduled';
  return '';
}

function firstDate(post, keys, assumeUtc=false){
  for(const key of keys){
    const d = toDate(post?.[key], assumeUtc);
    if(d) return d;
  }
  return null;
}

function eventForPost(post, filter){
  const status = statusKey(post?.status);
  const scheduled = firstDate(post, ['scheduled_at'], false);
  const uploaded = firstDate(post, ['uploaded_at','uploadedAt','upload_time','uploadTime','uploaded_time','uploadedTime','upload_at','uploadAt'], true);
  const posted = firstDate(post, ['posted_at','postedAt','published_at','publishedAt','post_time','postTime','published_time','publishedTime'], true);
  const created = firstDate(post, ['created_at','createdAt'], true);
  const updated = firstDate(post, ['updated_at','updatedAt'], true);

  const currentEvent = (() => {
    if(status === 'uploaded') {
      const date = uploaded || updated || created;
      return date ? { type:'uploaded', date, label:'Uploaded' } : null;
    }
    if(status === 'posted') {
      const date = posted || updated || created;
      return date ? { type:'posted', date, label:'Posted' } : null;
    }
    if(status === 'scheduled') {
      return scheduled ? { type:'scheduled', date:scheduled, label:'Scheduled' } : null;
    }
    if(posted) return { type:'posted', date:posted, label:'Posted' };
    if(uploaded) return { type:'uploaded', date:uploaded, label:'Uploaded' };
    if(scheduled) return { type:'scheduled', date:scheduled, label:'Scheduled' };
    return null;
  })();

  if(filter === 'all') return currentEvent ? [currentEvent] : [];
  return currentEvent?.type === filter ? [currentEvent] : [];
}

export default function CalendarView(){
  const [current, setCurrent] = useState(()=>new Date());
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  const loadPosts = ()=>{
    setLoading(true);
    setError('');
    return api.get('/posts')
      .then(r=>setPosts(Array.isArray(r.data) ? r.data : []))
      .catch(()=>{
        setPosts([]);
        setError('Unable to load calendar posts.');
      })
      .finally(()=>setLoading(false));
  };

  useEffect(()=>{
    let alive = true;
    setLoading(true);
    api.get('/posts').then(r=>{ if(alive) setPosts(Array.isArray(r.data) ? r.data : []); })
      .catch(()=>{ if(alive){ setPosts([]); setError('Unable to load calendar posts.'); } })
      .finally(()=>{ if(alive) setLoading(false); });
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

  const events = useMemo(()=>{
    const output = [];
    posts.forEach(post=>eventForPost(post, filter).forEach(event=>output.push({
      ...event,
      post,
      key: `${post.id}-${event.type}-${event.date.getTime()}`,
    })));
    return output;
  },[posts, filter]);

  const byDate = useMemo(()=>{
    const map = {};
    events.forEach(event=>{
      const key = dateKey(event.date);
      (map[key] ||= []).push(event);
    });
    Object.values(map).forEach(items=>items.sort((a,b)=>a.date-b.date));
    return map;
  },[events]);

  const monthEvents = useMemo(()=>events.filter(event=>
    event.date.getFullYear() === current.getFullYear() && event.date.getMonth() === current.getMonth()
  ),[events,current]);

  const goMonth = (delta)=>setCurrent(d=>new Date(d.getFullYear(),d.getMonth()+delta,1));
  const goToday = ()=>setCurrent(new Date());

  return (
    <div className="page calendar">
      <style>{`
        .calendar{width:100%;min-width:0}
        .calendar-toolbar{flex-wrap:wrap}
        .calendar-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .calendar-month{min-width:140px;text-align:center}
        .calendar-filter-bar{overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
        .calendar-filter-bar::-webkit-scrollbar{display:none}
        .calendar-day{min-width:0;overflow:hidden}
        .calendar-item{min-width:0;width:100%;text-align:left;overflow:hidden;padding:3px 6px;border-radius:5px;line-height:1.1}
        .calendar-item-top{min-width:0;display:flex;align-items:center;gap:5px}
        .calendar-item-title{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .calendar-item-time{white-space:nowrap;flex:0 0 auto;font-size:10px}
        .calendar-item-content-type{display:inline-flex;flex:0 1 32%;font-size:10px;font-weight:400;line-height:1;max-width:32%;margin-left:5px;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .calendar-item-content-type::before{content:'• ';}
        .calendar-filter-bar button{flex:0 0 auto}
        @media (max-width:900px){
          .main-content{padding:14px}
          .calendar-toolbar{padding:12px;gap:12px}
          .calendar-toolbar > div:first-child{min-width:0;flex:1 1 100%}
          .calendar-controls{width:100%;display:grid;grid-template-columns:auto 40px minmax(120px,1fr) 40px auto;gap:6px}
          .calendar-controls .btn-secondary{min-height:38px;padding:0 8px}
          .calendar-month{min-width:0;font-size:14px}
          .calendar-filter-bar{margin-bottom:10px!important;flex-wrap:nowrap!important}
          .calendar-filter-bar button{min-height:36px;padding:0 11px;font-size:12px}
          .calendar-grid{grid-template-columns:repeat(7,minmax(92px,1fr));overflow-x:auto;-webkit-overflow-scrolling:touch}
          .calendar-weekdays{grid-template-columns:repeat(7,minmax(92px,1fr));overflow-x:auto;-webkit-overflow-scrolling:touch}
        }
        @media (max-width:640px){
          .main-content{padding:10px}
          .calendar-toolbar h2{font-size:18px}
          .calendar-subtitle{font-size:12px}
          .calendar-controls{grid-template-columns:1fr 38px minmax(100px,1.4fr) 38px 1fr}
          .calendar-controls .btn-secondary{font-size:11px;min-height:36px}
          .calendar-filter-bar{gap:6px!important}
          .calendar-grid{grid-template-columns:repeat(7,minmax(74px,1fr))}
          .calendar-weekdays{grid-template-columns:repeat(7,minmax(74px,1fr))}
          .calendar-day{min-height:86px;padding:5px}
          .calendar-day-number{font-size:12px}
          .calendar-count{font-size:10px}
          .calendar-item{padding:2px 4px;border-radius:5px}
          .calendar-item-top{gap:3px}
          .calendar-item-title{font-size:10px}
          .calendar-item-time{font-size:9px}
          .calendar-item-content-type{font-size:8px;max-width:32%;flex-basis:32%;margin-left:3px}
          .calendar-more{font-size:9px}
          .calendar-weekdays > div{font-size:10px;padding:8px 4px}
        }
        @media (max-width:480px){
          .calendar-controls{grid-template-columns:1fr 34px minmax(88px,1.3fr) 34px 1fr}
          .calendar-controls .btn-secondary{padding:0 4px;font-size:10px}
          .calendar-grid{grid-template-columns:repeat(7,minmax(66px,1fr))}
          .calendar-weekdays{grid-template-columns:repeat(7,minmax(66px,1fr))}
          .calendar-day{min-height:78px;padding:4px}
          .calendar-item-title{font-size:9px}
          .calendar-item-time{font-size:8px}
          .calendar-item-content-type{font-size:7px;max-width:32%;flex-basis:32%}
        }
      `}</style>

      <div className="calendar-toolbar">
        <div>
          <h2>Calendar View</h2>
          <div className="calendar-subtitle">
            {monthEvents.length} {filter === 'all' ? 'calendar' : FILTERS.find(item=>item.key===filter)?.label.toLowerCase()} {monthEvents.length===1?'item':'items'} this month
          </div>
        </div>

        <div className="calendar-controls">
          <button type="button" className="btn-secondary" onClick={goToday}>Today</button>
          <button type="button" className="btn-secondary" onClick={()=>goMonth(-1)} aria-label="Previous month">‹</button>
          <strong className="calendar-month">{monthLabel(current)}</strong>
          <button type="button" className="btn-secondary" onClick={()=>goMonth(1)} aria-label="Next month">›</button>
          <button type="button" className="btn-secondary" onClick={loadPosts}>Refresh</button>
        </div>
      </div>

      <div className="calendar-filter-bar" style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
        {FILTERS.map(item=>(
          <button key={item.key} type="button" className={filter === item.key ? 'btn-primary' : 'btn-secondary'} onClick={()=>setFilter(item.key)}>
            {item.label}
          </button>
        ))}
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
                {items.slice(0,5).map(event=>{
                  const post = event.post;
                  return (
                    <button
                      key={event.key}
                      type="button"
                      className={`calendar-item ${event.type} ${post.status?.toLowerCase()||''}`}
                      onClick={()=>window.dispatchEvent(new CustomEvent('editPost',{detail:post}))}
                      title={`${event.label} · ${formatDateTime(event.date)}`}
                    >
                      <div className="calendar-item-top">
                        <span className="calendar-item-title">{post.project_name || '(untitled)'}</span>
                        {post.content_type ? <span className="calendar-item-content-type">{post.content_type}</span> : null}
                        <span className="calendar-item-time">{formatTime(event.date)}</span>
                      </div>
                    </button>
                  );
                })}
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
