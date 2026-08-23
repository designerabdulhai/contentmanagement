import React, {useEffect, useState, useMemo} from 'react'
import api from '../api'
import LinkActions from '../components/LinkActions'

function buildCounts(posts, field){
  return posts.reduce((acc, post)=>{
    const key = post?.[field] || 'Unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function DonutChart({title, data, total}){
  const entries = Object.entries(data);
  const palette = ['#6c5ce7','#3b82f6','#10b981','#f59e0b','#ef4444','#14b8a6','#8b5cf6','#ec4899'];
  let cursor = 0;
  const segments = entries.map(([label,value], index)=>{
    const start = cursor;
    cursor += value / Math.max(total,1) * 100;
    return {label, value, start, end:cursor, color:palette[index % palette.length]};
  });
  const background = segments.length
    ? `conic-gradient(${segments.map(s=>`${s.color} ${s.start}% ${s.end}%`).join(', ')})`
    : 'conic-gradient(var(--border) 0% 100%)';

  return (
    <div className="chart card dashboard-chart-card">
      <div className="card-header"><h3>{title}</h3><span className="chart-total">{total}</span></div>
      <div className="chart-content">
        <div className="donut" style={{background}} aria-label={`${title}: ${total}`}>
          <div className="donut-hole">{total}</div>
        </div>
        <div className="chart-legend">
          {segments.length ? segments.map(s=>(
            <div className="legend-row" key={s.label}>
              <span className="legend-dot" style={{background:s.color}} />
              <span className="legend-label">{s.label}</span>
              <strong>{s.value}</strong>
            </div>
          )) : <div className="legend-empty">No data yet</div>}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard(){
  const [summary, setSummary] = useState({});
  const [posts, setPosts] = useState([]);
  const [dueSoon, setDueSoon] = useState([]);

  const loadDashboard = ()=>{
    api.get('/summary').then(r=>setSummary(r.data || {})).catch(()=>{});
    api.get('/posts').then(r=>setPosts(Array.isArray(r.data) ? r.data : [])).catch(()=>setPosts([]));
    api.get('/dashboard/due-soon').then(r=>setDueSoon(Array.isArray(r.data) ? r.data.slice(0,5) : [])).catch(()=>setDueSoon([]));
  };

  useEffect(()=>{ loadDashboard(); },[])

  const openNewPost = () => window.dispatchEvent(new CustomEvent('requestNewPost'));
  const openBulk = () => window.dispatchEvent(new CustomEvent('requestBulkCreate'));

  const stats = [
    {key:'total', label:'Total posts', value: summary.total||0, icon:'📁', trend:'+4%'},
    {key:'scheduledWeek', label:'Scheduled this week', value: summary.scheduledWeek||0, icon:'🗓️', trend:'+1%'},
    {key:'uploadedMonth', label:'Uploaded this month', value: summary.uploadedMonth||0, icon:'⬆️', trend:'-2%'},
    {key:'listedCount', label:'Listed', value: summary.listedCount||0, icon:'📝', trend:'+0%'}
  ];

  const channelCounts = useMemo(()=>buildCounts(posts,'channel'),[posts]);
  const typeCounts = useMemo(()=>buildCounts(posts,'content_type'),[posts]);

  return (
    <div className="page dashboard">
      <div className="dashboard-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:18}}>
        <div>
          <h2 style={{margin:'0 0 4px'}}>Dashboard</h2>
          <div style={{color:'var(--muted)',fontSize:13}}>Manage projects and scheduled content from one place.</div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'flex-end'}}>
          <button className="btn-secondary" type="button" onClick={openBulk}>Bulk Create</button>
          <button className="btn-primary" type="button" onClick={openNewPost}>+ New Scheduled Post</button>
        </div>
      </div>

      <div className="cards">
        {stats.map(s=> (
          <div className="card stat-card" key={s.key}>
            <div className="stat-badge">{s.icon}</div>
            <div className="stat-body">
              <div className="stat-label">{s.label}</div>
              <div className="stat-value">{s.value}</div>
              <div className="stat-trend">{s.trend}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="charts dashboard-charts">
        <DonutChart title="Posts by Channel" data={channelCounts} total={posts.length} />
        <DonutChart title="Posts by Content Type" data={typeCounts} total={posts.length} />
      </div>

      <div className="recent card">
        <h3>Recent activity</h3>
        <ul>{posts.slice(-10).reverse().map(p=> <li key={p.id}>{p.project_name||'(untitled)'} — {p.status} — {p.scheduled_at||'no date'}</li>)}</ul>
      </div>

      <div className="card due-soon">
        <h3>Due Today / This Week</h3>
        <ul>
          {dueSoon.map(p=> (
            <li key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <div>{p.project_name||'(untitled)'} — {p.channel} — {p.scheduled_at}</div>
                <div className="link-text" title={p.uploaded_link||''}>{p.uploaded_link||''}</div>
                <LinkActions url={p.uploaded_link} />
              </div>
              <div><button type="button" onClick={()=>api.post('/posts/'+p.id+'/mark-uploaded',{ uploaded_link:p.uploaded_link||null }).then(()=>{ setDueSoon(ds=>ds.filter(x=>x.id!==p.id)); loadDashboard(); })}>Mark Uploaded</button></div>
            </li>
          ))}
        </ul>
        <div><button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('navigateToList'))}>View all</button></div>
      </div>
    </div>
  )
}
