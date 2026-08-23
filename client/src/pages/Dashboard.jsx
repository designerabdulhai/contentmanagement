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
    result[day] = (result[day] || 0) + 1;
  });
  return result;
}

const tooltipBgStyle = {fill:'#ffffff',stroke:'#d9dee8',strokeWidth:1,filter:'drop-shadow(0 3px 8px rgba(15,23,42,.14))'};
const tooltipTitleStyle = {fill:'#111827',fontSize:11,fontWeight:700};
const tooltipValueStyle = {fill:'#667085',fontSize:11,fontWeight:600};

function AreaChart({title, data}){
  const [hovered, setHovered] = useState(null);
  const entries = title === 'Posts by Day' ? WEEKDAYS.map(day=>[day, data[day] || 0]) : Object.entries(data);
  const values = entries.map(([,v])=>v);
  const max = Math.max(...values, 1);
  const width = 640, height = 280, left = 44, right = 22, top = 26, bottom = 38;
  const chartW = width-left-right, chartH = height-top-bottom;
  const points = entries.map(([,v], i)=>({
    x: entries.length === 1 ? width/2 : left + (i/(entries.length-1))*chartW,
    y: top + chartH - (v/max)*chartH,
    value:v
  }));
  const line = points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ');
  const lastPoint = points[points.length-1] || {x:left};
  const firstPoint = points[0] || {x:left};
  const area = `${line} L ${lastPoint.x} ${top+chartH} L ${firstPoint.x} ${top+chartH} Z`;
  const grid = [0,.25,.5,.75,1];
  const gradientId = `areaGradient-${title.replace(/[^a-z0-9]/gi,'-')}`;

  return <div className="chart card dashboard-chart-card">
    <div className="card-header"><div><h3>{title}</h3></div><span className="chart-total">{values.reduce((a,b)=>a+b,0)}</span></div>
    <div className="reference-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="reference-chart" role="img" aria-label={`${title}. Hover a point to see its data.`}>
        <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6c5ce7" stopOpacity="0.34"/><stop offset="100%" stopColor="#6c5ce7" stopOpacity="0.08"/></linearGradient></defs>
        {grid.map((r,i)=>{const y=top+chartH-r*chartH;return <g key={i}><line x1={left} x2={width-right} y1={y} y2={y} className="reference-grid-line"/><text x={8} y={y+4} className="reference-axis-label">{Math.round(max*r)}</text></g>})}
        <path d={area} fill={`url(#${gradientId})`} className="reference-area"/>
        <path d={line} className="reference-line"/>
        {points.map((p,i)=>{
          const isHovered = hovered === i;
          const label = entries[i][0];
          const tooltipW = Math.max(96, label.length * 7 + 52);
          const tooltipX = Math.min(Math.max(p.x - tooltipW/2, 4), width-tooltipW-4);
          const tooltipY = Math.max(p.y - 48, 4);
          return <g key={i} onMouseEnter={()=>setHovered(i)} onMouseLeave={()=>setHovered(null)} onFocus={()=>setHovered(i)} onBlur={()=>setHovered(null)}>
            <circle cx={p.x} cy={p.y} r={isHovered ? 7 : 5} className="reference-point" tabIndex="0" role="button" aria-label={`${label}: ${p.value}`}/>
            {isHovered && <g pointerEvents="none">
              <rect x={tooltipX} y={tooltipY} width={tooltipW} height="38" rx="7" style={tooltipBgStyle}/>
              <text x={tooltipX+10} y={tooltipY+15} style={tooltipTitleStyle}>{label}</text>
              <text x={tooltipX+10} y={tooltipY+30} style={tooltipValueStyle}>{p.value} post{p.value === 1 ? '' : 's'}</text>
            </g>}
          </g>
        })}
        {entries.map(([label],i)=><text key={label} x={points[i].x} y={height-10} textAnchor="middle" className="reference-axis-label">{label}</text>)}
      </svg>
    </div>
  </div>
}

function BarChart({title, data}){
  const [hovered, setHovered] = useState(null);
  const entries = Object.entries(data);
  const max = Math.max(...entries.map(([,v])=>v),1);
  return <div className="chart card dashboard-chart-card">
    <div className="card-header"><h3>{title}</h3><span className="chart-total">{entries.reduce((a,[,v])=>a+v,0)}</span></div>
    <div className="reference-bars">
      {entries.length ? entries.map(([label,value],i)=>{
        const isHovered = hovered === label;
        return <div className="reference-bar-row" key={label} onMouseEnter={()=>setHovered(label)} onMouseLeave={()=>setHovered(null)} onFocus={()=>setHovered(label)} onBlur={()=>setHovered(null)} tabIndex="0" role="button" aria-label={`${label}: ${value}`} style={{position:'relative'}}>
          <div className="reference-bar-label" title={label}>{label}</div>
          <div className="reference-bar-track"><div className="reference-bar-fill" style={{width:`${Math.max(8,(value/max)*100)}%`,background:PALETTE[i%PALETTE.length]}}><span>{value}</span></div></div>
          {isHovered && <div style={{position:'absolute',right:0,top:'-42px',zIndex:10,background:'#fff',border:'1px solid #d9dee8',borderRadius:7,padding:'7px 10px',boxShadow:'0 4px 12px rgba(15,23,42,.14)',display:'flex',gap:8,alignItems:'center',fontSize:11,whiteSpace:'nowrap',pointerEvents:'none'}}><strong style={{color:'#111827'}}>{label}</strong><span style={{color:'#667085'}}>{value} post{value === 1 ? '' : 's'}</span></div>}
        </div>
      }) : <div className="chart-empty">No data yet</div>}
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
    <div className="charts dashboard-chart-grid">
      <AreaChart title="Posts by Day" data={dayCounts}/>
      <AreaChart title="Posts by Channel" data={channelCounts}/>
      <AreaChart title="Posts by Content Type" data={typeCounts}/>
      <BarChart title="Content Mix" data={typeCounts}/>
    </div>
    <div className="recent card"><h3>Recent activity</h3><ul>{posts.slice(-10).reverse().map(p=><li key={p.id}>{p.project_name||'(untitled)'} — {p.status} — {p.scheduled_at||'no date'}</li>)}</ul></div>
    <div className="card due-soon"><h3>Due Today / This Week</h3><ul>{dueSoon.map(p=><li key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div style={{display:'flex',alignItems:'center',gap:8}}><div>{p.project_name||'(untitled)'} — {p.channel} — {p.scheduled_at}</div><div className="link-text" title={p.uploaded_link||''}>{p.uploaded_link||''}</div><LinkActions url={p.uploaded_link}/></div><div><button type="button" onClick={()=>api.post('/posts/'+p.id+'/mark-uploaded',{uploaded_link:p.uploaded_link||null}).then(()=>{setDueSoon(ds=>ds.filter(x=>x.id!==p.id));loadDashboard()})}>Mark Uploaded</button></div></li>)}</ul><div><button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('navigateToList'))}>View all</button></div></div>
  </div>
}
