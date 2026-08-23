import React, {useEffect, useState, useMemo} from 'react'
import api from '../api'
import LinkActions from '../components/LinkActions'

const PALETTE = ['#6c5ce7','#3b82f6','#10b981','#f59e0b','#ef4444','#14b8a6','#8b5cf6','#ec4899'];
const WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function buildCounts(posts, field){
  return posts.reduce((acc, post)=>{
    const key = post?.[field] || 'Unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function weeklyCounts(posts){
  const result = Object.fromEntries(WEEKDAYS.map(d=>[d,0]));
  posts.forEach(p=>{
    if(!p?.scheduled_at) return;
    const d = new Date(p.scheduled_at);
    if(Number.isNaN(d.getTime())) return;
    const day = d.toLocaleDateString('en-US',{weekday:'short'});
    if(day === 'Sun') result.Sun += 1;
    else result[day] = (result[day] || 0) + 1;
  });
  return result;
}

function AreaChart({title, data}){
  const entries = WEEKDAYS.map(day=>[day, data[day] || 0]);
  const values = entries.map(([,v])=>v);
  const max = Math.max(...values, 1);
  const width = 640, height = 280, left = 44, right = 22, top = 26, bottom = 38;
  const chartW = width-left-right, chartH = height-top-bottom;
  const points = entries.map(([,v], i)=>({
    x: left + (i/(entries.length-1))*chartW,
    y: top + chartH - (v/max)*chartH,
    value:v
  }));
  const line = points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ');
  const area = `${line} L ${points.at(-1).x} ${top+chartH} L ${points[0].x} ${top+chartH} Z`;
  const grid = [0,.25,.5,.75,1];
  return <div className="chart card dashboard-chart-card">
    <div className="card-header"><div><h3>{title}</h3></div><span className="chart-total">{values.reduce((a,b)=>a+b,0)}</span></div>
    <div className="reference-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="reference-chart" role="img" aria-label={title}>
        <defs><linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6c5ce7" stopOpacity="0.34"/><stop offset="100%" stopColor="#6c5ce7" stopOpacity="0.08"/></linearGradient></defs>
        {grid.map((r,i)=>{const y=top+chartH-r*chartH;return <g key={i}><line x1={left} x2={width-right} y1={y} y2={y} className="reference-grid-line"/><text x={8} y={y+4} className="reference-axis-label">{Math.round(max*r)}</text></g>})}
        <path d={area} fill="url(#areaGradient)" className="reference-area"/>
        <path d={line} className="reference-line"/>
        {points.map((p,i)=><g key={i}><circle cx={p.x} cy={p.y} r="5" className="reference-point"/><title>{`${entries[i][0]}: ${p.value}`}</title></g>)}
        {entries.map(([label],i)=><text key={label} x={points[i].x} y={height-10} textAnchor="middle" className="reference-axis-label">{label}</text>)}
      </svg>
    </div>
  </div>
}

function BarChart({title, data, horizontal=false}){
  const entries = Object.entries(data);
  const max = Math.max(...entries.map(([,v])=>v),1);
  return <div className="chart card dashboard-chart-card">
    <div className="card-header"><h3>{title}</h3><span className="chart-total">{entries.reduce((a,[,v])=>a+v,0)}</span></div>
    <div className={`reference-bars ${horizontal?'horizontal':''}`}>
      {entries.length ? entries.map(([label,value],i)=><div className="reference-bar-row" key={label}>
        <div className="reference-bar-label" title={label}>{label}</div>
        <div className="reference-bar-track"><div className="reference-bar-fill" style={{width:`${Math.max(8,(value/max)*100)}%`,background:PALETTE[i%PALETTE.length]}}><span>{value}</span></div></div>
      </div>) : <div className="chart-empty">No data yet</div>}
    </div>
  </div>
}

function DonutChart({title, data, total}){
  const entries = Object.entries(data);
  let cursor = 0;
  const segments = entries.map(([label,value],i)=>{const start=cursor;cursor += value/Math.max(total,1)*100;return {label,value,start,end:cursor,color:PALETTE[i%PALETTE.length]};});
  const background = segments.length ? `conic-gradient(${segments.map(s=>`${s.color} ${s.start}% ${s.end}%`).join(', ')})` : 'var(--border)';
  return <div className="chart card dashboard-chart-card"><div className="card-header"><h3>{title}</h3><span className="chart-total">{total}</span></div><div className="chart-content"><div className="donut" style={{background}}><div className="donut-hole">{total}</div></div><div className="chart-legend">{segments.length?segments.map(s=><div className="legend-row" key={s.label}><span className="legend-dot" style={{background:s.color}}/><span className="legend-label">{s.label}</span><strong>{s.value}</strong></div>):<div className="legend-empty">No data yet</div>}</div></div></div>
}

export default function Dashboard(){
  const [summary,setSummary]=useState({});
  const [posts,setPosts]=useState([]);
  const [dueSoon,setDueSoon]=useState([]);
  const loadDashboard=()=>{
    api.get('/summary').then(r=>setSummary(r.data||{})).catch(()=>{});
    api.get('/posts').then(r=>setPosts(Array.isArray(r.data)?r.data:[])).catch(()=>setPosts([]));
    api.get('/dashboard/due-soon').then(r=>setDueSoon(Array.isArray(r.data)?r.data.slice(0,5):[])).catch(()=>setDueSoon([]));
  };
  useEffect(()=>{loadDashboard()},[])
  const channelCounts=useMemo(()=>buildCounts(posts,'channel'),[posts]);
  const typeCounts=useMemo(()=>buildCounts(posts,'content_type'),[posts]);
  const dayCounts=useMemo(()=>weeklyCounts(posts),[posts]);
  const stats=[
    {key:'total',label:'Total posts',value:summary.total||0,icon:'📁',trend:'+4%'},
    {key:'scheduledWeek',label:'Scheduled this week',value:summary.scheduledWeek||0,icon:'🗓️',trend:'+1%'},
    {key:'uploadedMonth',label:'Uploaded this month',value:summary.uploadedMonth||0,icon:'⬆️',trend:'-2%'},
    {key:'listedCount',label:'Listed',value:summary.listedCount||0,icon:'📝',trend:'+0%'}
  ];
  return <div className="page dashboard">
    <div className="dashboard-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:18}}><div><h2 style={{margin:'0 0 4px'}}>Dashboard</h2><div style={{color:'var(--muted)',fontSize:13}}>Manage projects and scheduled content from one place.</div></div><div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'flex-end'}}><button className="btn-secondary" type="button" onClick={()=>window.dispatchEvent(new CustomEvent('requestBulkCreate'))}>Bulk Create</button><button className="btn-primary" type="button" onClick={()=>window.dispatchEvent(new CustomEvent('requestNewPost'))}>+ New Scheduled Post</button></div></div>
    <div className="cards">{stats.map(s=><div className="card stat-card" key={s.key}><div className="stat-badge">{s.icon}</div><div className="stat-body"><div className="stat-label">{s.label}</div><div className="stat-value">{s.value}</div><div className="stat-trend">{s.trend}</div></div></div>)}</div>
    <div className="charts dashboard-chart-grid"><AreaChart title="Posts by Day" data={dayCounts}/><AreaChart title="Posts by Channel" data={dayCounts}/><AreaChart title="Posts by Content Type" data={dayCounts}/><BarChart title="Content Mix" data={typeCounts}/></div>
    <div className="recent card"><h3>Recent activity</h3><ul>{posts.slice(-10).reverse().map(p=><li key={p.id}>{p.project_name||'(untitled)'} — {p.status} — {p.scheduled_at||'no date'}</li>)}</ul></div>
    <div className="card due-soon"><h3>Due Today / This Week</h3><ul>{dueSoon.map(p=><li key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div style={{display:'flex',alignItems:'center',gap:8}}><div>{p.project_name||'(untitled)'} — {p.channel} — {p.scheduled_at}</div><div className="link-text" title={p.uploaded_link||''}>{p.uploaded_link||''}</div><LinkActions url={p.uploaded_link}/></div><div><button type="button" onClick={()=>api.post('/posts/'+p.id+'/mark-uploaded',{uploaded_link:p.uploaded_link||null}).then(()=>{setDueSoon(ds=>ds.filter(x=>x.id!==p.id));loadDashboard()})}>Mark Uploaded</button></div></li>)}</ul><div><button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('navigateToList'))}>View all</button></div></div>
  </div>
}
