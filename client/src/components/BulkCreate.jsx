import React, {useState, useEffect} from 'react'
import api from '../api'

export default function BulkCreate({onClose, onDone}){
  const [projectName, setProjectName] = useState('');
  const [contentType, setContentType] = useState('');
  const [channel, setChannel] = useState('');
  const [platform, setPlatform] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [occurrences, setOccurrences] = useState(0);
  const [days, setDays] = useState([0,1,2,3,4,5,6]);
  const [countPreview, setCountPreview] = useState(0);

  useEffect(()=>{
    // compute rough preview count
    if(!startDate) return setCountPreview(0);
    const s = new Date(startDate);
    const e = endDate ? new Date(endDate) : new Date(s.getTime()+30*24*3600*1000);
    let c=0; let cur = new Date(s);
    while(cur<=e && c<10000){ if(days.includes(cur.getDay())) c++; cur.setDate(cur.getDate()+1);} setCountPreview(c);
  },[startDate,endDate,days]);

  const toggleDay = (d)=>{
    setDays(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev, d]);
  }

  const submit = async ()=>{
    if(!projectName || !startDate){ alert('Project name and start date required'); return; }
    const should = window.confirm(`This will create ${countPreview} posts. Continue?`);
    if(!should) return;
    const payload = { project_name: projectName, content_type: contentType, channel, platform, start_date: startDate, end_date: endDate||null, days_of_week: days, occurrences: occurrences||null };
    const res = await api.post('/posts/bulk', payload);
    alert(`Created ${res.data.created_count} posts`);
    onDone && onDone(res.data);
  }

  return (
    <div className="modal card">
      <h3>Bulk Create (Recurring Slots)</h3>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <input placeholder="Project name" value={projectName} onChange={e=>setProjectName(e.target.value)} />
        <input placeholder="Content type" value={contentType} onChange={e=>setContentType(e.target.value)} />
        <input placeholder="Channel" value={channel} onChange={e=>setChannel(e.target.value)} />
        <input placeholder="Platform" value={platform} onChange={e=>setPlatform(e.target.value)} />
        <div>
          <label>Start date</label>
          <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} />
        </div>
        <div>
          <label>End date (optional)</label>
          <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} />
        </div>
      </div>
      <div style={{marginTop:8}}>
        <label>Days of week</label>
        <div style={{display:'flex',gap:6,marginTop:6}}>
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,i)=> (
            <button key={i} className={days.includes(i)?'active':''} onClick={()=>toggleDay(i)}>{d}</button>
          ))}
        </div>
      </div>
      <div style={{marginTop:8}}>Occurrences (optional): <input type="number" value={occurrences} onChange={e=>setOccurrences(Number(e.target.value))} /></div>
      <div style={{marginTop:12}}>Preview count: <strong>{countPreview}</strong></div>
      <div style={{marginTop:12,display:'flex',gap:8,justifyContent:'flex-end'}}>
        <button onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit}>Create {countPreview} posts</button>
      </div>
    </div>
  )
}
