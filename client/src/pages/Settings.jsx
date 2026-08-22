import React, {useEffect, useState} from 'react'
import api from '../api'

export default function Settings(){
  const [settings, setSettings] = useState({});
  const [newInvite, setNewInvite] = useState('');
  const [templates, setTemplates] = useState([]);

  useEffect(()=>{ api.get('/settings').then(r=>setSettings(r.data)); },[])
  useEffect(()=>{ api.get('/templates').then(r=>setTemplates(r.data)).catch(()=>{}); },[])

  const save = (key, values)=> api.put('/settings/'+key, values).then(()=>api.get('/settings').then(r=>setSettings(r.data)));

  const invite = ()=>{ api.post('/invite',{email:newInvite,role:'manager'}).then(()=>{ setNewInvite(''); }); }

  return (
    <div className="page settings">
      <h2>Settings</h2>
      <div className="setting-group">
        <label>Content Types (comma separated)</label>
        <input defaultValue={(settings.content_types||[]).join(', ')} onBlur={e=>save('content_types', e.target.value.split(',').map(s=>s.trim()))} />
      </div>
      <div className="setting-group">
        <label>Channels</label>
        <input defaultValue={(settings.channels||[]).join(', ')} onBlur={e=>save('channels', e.target.value.split(',').map(s=>s.trim()))} />
      </div>
      <div className="setting-group">
        <label>Platforms</label>
        <input defaultValue={(settings.platforms||[]).join(', ')} onBlur={e=>save('platforms', e.target.value.split(',').map(s=>s.trim()))} />
      </div>
      <div className="invite">
        <h3>Invite Manager</h3>
        <input placeholder="Email" value={newInvite} onChange={e=>setNewInvite(e.target.value)} />
        <button onClick={invite}>Invite</button>
      </div>
      <div className="card">
        <h3>Templates</h3>
        <ul>
          {templates.map(t=> <li key={t.id}>{t.name} — {t.content_type} / {t.channel} <button onClick={()=>{ api.delete('/templates/'+t.id).then(()=> setTemplates(ts=>ts.filter(x=>x.id!==t.id))); }}>Delete</button></li>)}
        </ul>
      </div>
    </div>
  )
}
