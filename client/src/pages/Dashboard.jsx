import React, {useEffect, useState} from 'react'
import api from '../api'
import { Bar } from 'react-chartjs-2'
import {Chart,BarElement,CategoryScale,LinearScale,Title,Tooltip,Legend} from 'chart.js'
Chart.register(BarElement,CategoryScale,LinearScale,Title,Tooltip,Legend)
import LinkActions from '../components/LinkActions'

export default function Dashboard(){
  const [summary, setSummary] = useState({});
  const [posts, setPosts] = useState([]);

  useEffect(()=>{
    api.get('/summary').then(r=>setSummary(r.data));
    api.get('/posts').then(r=>setPosts(r.data.slice(-10).reverse()));
    api.get('/dashboard/due-soon').then(r=>setDueSoon(r.data.slice(0,5))).catch(()=>{});
  },[])

  const [dueSoon, setDueSoon] = useState([]);

  const stats = [
    {key:'total', label:'Total posts', value: summary.total||0, icon:'📁', trend:'+4%'},
    {key:'scheduledWeek', label:'Scheduled this week', value: summary.scheduledWeek||0, icon:'🗓️', trend:'+1%'},
    {key:'uploadedMonth', label:'Uploaded this month', value: summary.uploadedMonth||0, icon:'⬆️', trend:'-2%'},
    {key:'listedCount', label:'Listed', value: summary.listedCount||0, icon:'📝', trend:'+0%'}
  ];

  return (
    <div className="page dashboard">
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

      <div className="charts">
        <div className="chart card">
          <div className="card-header"><h3>Posts by Channel</h3></div>
          <div className="card-body">(chart placeholder)</div>
        </div>

        <div className="chart card">
          <div className="card-header"><h3>Posts by Content Type</h3></div>
          <div className="card-body">(chart placeholder)</div>
        </div>
      </div>

      <div className="recent card">
        <h3>Recent activity</h3>
        <ul>
          {posts.map(p=> <li key={p.id}>{p.project_name||'(untitled)'} — {p.status} — {p.scheduled_at||'no date'}</li>)}
        </ul>
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
              <div><button onClick={()=>{ api.post('/posts/'+p.id+'/mark-uploaded',{ uploaded_link: p.uploaded_link||null }).then(()=> setDueSoon(ds=>ds.filter(x=>x.id!==p.id))); }}>Mark Uploaded</button></div>
            </li>
          ))}
        </ul>
        <div><button onClick={()=>{ localStorage.setItem('list_filter_dueSoon','1'); window.dispatchEvent(new CustomEvent('navigateToList')); }}>View all</button></div>
      </div>
    </div>
  )
}
