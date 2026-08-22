import React, {useEffect, useState, useRef} from 'react'
import api from '../api'
import LinkActions from './LinkActions'

export default function PostForm({onSaved}){
  const empty = {project_name:'', content_type:'', channel:'', platform:'', status:'Listed', scheduled_at:'', uploaded_link:'', notes:''};
  const [post, setPost] = useState(empty);
  const [settings, setSettings] = useState({});
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsCache = useRef({});
  const debounceRef = useRef(null);
  const [selectedProjectPanel, setSelectedProjectPanel] = useState(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [templates, setTemplates] = useState([]);
  useEffect(()=>{ api.get('/settings').then(r=>setSettings(r.data));
    api.get('/templates').then(r=> setTemplates(r.data)).catch(()=>{});
    const onEdit = (e)=> setPost(e.detail);
    window.addEventListener('editPost', onEdit);
    return ()=>window.removeEventListener('editPost', onEdit);
  },[])
  const [autoFillHint, setAutoFillHint] = useState(null);

  const save = ()=>{
    if(post.id) api.put('/posts/'+post.id, post).then(r=>{ onSaved && onSaved(r.data); });
    else api.post('/posts', post).then(r=>{ onSaved && onSaved(r.data); });
  }

  const useTemplate = (tId)=>{
    const t = templates.find(x=>x.id==tId);
    if(!t) return;
    setPost({...post, content_type: t.content_type, channel: t.channel, platform: t.platform});
  }

  const saveTemplate = ()=>{
    const name = window.prompt('Template name');
    if(!name) return;
    api.post('/templates', { name, content_type: post.content_type, channel: post.channel, platform: post.platform }).then(r=>{
      setTemplates([r.data, ...templates]);
      alert('Template saved');
    })
  }

  const onPasteLink = (e)=>{
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    if(!pasted) return;
    const url = pasted.toLowerCase();
    const hints = [];
    if(url.includes('youtube.com') || url.includes('youtu.be')) hints.push({channel:'YouTube', platform:'Google'});
    if(url.includes('instagram.com')) hints.push({channel:'Instagram', platform:'Meta'});
    if(url.includes('tiktok.com')) hints.push({channel:'TikTok', platform:'TikTok'});
    if(hints.length && (!post.channel || !post.platform)){
      const h = hints[0];
      setPost({...post, uploaded_link: pasted, channel: post.channel || h.channel, platform: post.platform || h.platform});
      setAutoFillHint(`Auto-filled Channel=${h.channel}, Platform=${h.platform} from link`);
      setTimeout(()=>setAutoFillHint(null), 6000);
    }
  }

  // Helpers for project name autocomplete
  const queryProjectSuggestions = (q)=>{
    if(!q) { setSuggestions([]); setShowSuggestions(false); return; }
    const key = q.toLowerCase();
    if(suggestionsCache.current[key]){
      setSuggestions(suggestionsCache.current[key]);
      setShowSuggestions(true);
      return;
    }
    api.get('/posts/project-suggestions', { params: { query: q } }).then(res=>{
      suggestionsCache.current[key] = res.data;
      setSuggestions(res.data);
      setShowSuggestions(true);
    }).catch(()=>{});
  }

  const onProjectNameChange = (val)=>{
    setPost({...post, project_name: val});
    setSelectedProjectPanel(null);
    // debounce
    if(debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(()=> queryProjectSuggestions(val), 300);
  }

  const selectSuggestion = (s)=>{
    setPost({...post, project_name: s.project_name});
    setShowSuggestions(false);
    setSelectedProjectPanel(s);
    setPanelOpen(true);
  }

  const maybeShowPanelForName = (name)=>{
    if(!name) return;
    // look in cache for exact match
    const key = name.toLowerCase();
    const found = suggestionsCache.current[key] || suggestions.find(x=>x.project_name.toLowerCase()===key);
    if(found){ setSelectedProjectPanel(found); setPanelOpen(true); }
  }

  // Suggest next likely date if pattern exists
  const computeNextFromPattern = (dates)=>{
    // dates are labels like 'Aug 12, 2026 · ...' but we also have raw ISO in API? We only returned formatted labels.
    // For simplicity, try to parse actual scheduled_at from cache by re-querying server for exact project details.
    // We'll implement a heuristic: if last_scheduled_dates have at least 3 entries with same weekday, suggest next weekday at same time.
    return null; // lightweight: not implemented fully here
  }


  return (
    <div className="postform drawer">
      <h3>{post.id? 'Edit Post':'Create New Post'}</h3>
      <div className="form-grid">
        <div style={{position:'relative'}}>
          <input placeholder="Project Name" value={post.project_name||''} onChange={e=>onProjectNameChange(e.target.value)} onBlur={(e)=>{ setTimeout(()=>setShowSuggestions(false), 150); maybeShowPanelForName(e.target.value); }} />

          {showSuggestions && suggestions.length>0 && (
            <div className="suggestions-dropdown card">
              {suggestions.map(s=> (
                <div key={s.project_name} className="suggestion-item" onClick={()=>selectSuggestion(s)}>
                  <div className="suggestion-name">{s.project_name}</div>
                  <div className="suggestion-meta">{s.count} past schedules</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <select value={post.content_type||''} onChange={e=>setPost({...post, content_type:e.target.value})}>
          <option value="">-- Content Type --</option>
          {(settings.content_types||[]).map(s=> <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{gridColumn:'1 / -1', display:'flex', gap:8, alignItems:'center'}}>
          <select onChange={e=>useTemplate(e.target.value)} defaultValue="">
            <option value="">Use Template</option>
            {templates.map(t=> <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button onClick={saveTemplate}>Save as Template</button>
        </div>
        <select value={post.channel||''} onChange={e=>setPost({...post, channel:e.target.value})}>
          <option value="">-- Channel --</option>
          {(settings.channels||[]).map(s=> <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={post.platform||''} onChange={e=>setPost({...post, platform:e.target.value})}>
          <option value="">-- Platform --</option>
          {(settings.platforms||[]).map(s=> <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={post.status||''} onChange={e=>setPost({...post, status:e.target.value})}>
          <option value="Listed">Listed</option>
          <option value="Scheduled">Scheduled</option>
          <option value="Uploaded">Uploaded</option>
        </select>
        <input type="datetime-local" value={post.scheduled_at||''} onChange={e=>setPost({...post, scheduled_at:e.target.value})} />
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <input placeholder="Uploaded Link" value={post.uploaded_link||''} onChange={e=>setPost({...post, uploaded_link:e.target.value})} onPaste={onPasteLink} />
          <LinkActions url={post.uploaded_link} />
        </div>
        {autoFillHint && <div className="autofill-hint">{autoFillHint} <button onClick={()=>{ setPost({...post, channel:'', platform:''}); setAutoFillHint(null); }}>Undo</button></div>}
        <textarea placeholder="Notes" value={post.notes||''} onChange={e=>setPost({...post, notes:e.target.value})} />
      </div>
      {/* Inline previous schedules panel */}
      {selectedProjectPanel && (
        <div className="project-panel card">
          <div className="panel-header">
            <strong>Previous schedules for this project</strong>
            <div className="panel-controls">
              <button onClick={()=>setPanelOpen(!panelOpen)}>{panelOpen? 'Collapse':'Expand'}</button>
              <button onClick={()=>setSelectedProjectPanel(null)}>Dismiss</button>
            </div>
          </div>
          {panelOpen && (
            <div className="panel-body">
              {selectedProjectPanel.last_scheduled_dates.map((row, idx)=> (
                <div className="panel-row" key={idx}>{row}</div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="form-actions">
        <button className="btn-primary" onClick={save}>Save</button>
        <button onClick={()=>{ setPost(empty); document.getElementById('createModal').classList.add('hidden'); }}>Cancel</button>
      </div>
    </div>
  )
}
