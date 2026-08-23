import React, {useEffect, useState, useRef} from 'react'
import api from '../api'
import LinkActions from './LinkActions'

export default function PostForm({onSaved,onCancel}){
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
  const [autoFillHint, setAutoFillHint] = useState(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [settingsError, setSettingsError] = useState('');

  useEffect(()=>{
    let alive = true;
    Promise.all([
      api.get('/settings'),
      api.get('/templates').catch(()=>({data:[]}))
    ]).then(([settingsResponse, templatesResponse])=>{
      if(!alive) return;
      setSettings(settingsResponse?.data || {});
      setTemplates(Array.isArray(templatesResponse?.data) ? templatesResponse.data : []);
      setSettingsError('');
    }).catch((error)=>{
      if(!alive) return;
      setSettingsError(error?.message || 'Could not load form options.');
      setSettings({});
      setTemplates([]);
    }).finally(()=>{
      if(alive) setLoadingSettings(false);
    });
    const onEdit = (e)=> setPost(e.detail || empty);
    window.addEventListener('editPost', onEdit);
    return ()=>{
      alive = false;
      window.removeEventListener('editPost', onEdit);
      if(debounceRef.current) clearTimeout(debounceRef.current);
    };
  },[])

  const save = ()=>{
    const request = post.id ? api.put('/posts/'+post.id, post) : api.post('/posts', post);
    request.then(r=>{ onSaved && onSaved(r.data); }).catch(()=>{});
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
    }).catch(()=>{});
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
    const key = name.toLowerCase();
    const found = suggestionsCache.current[key] || suggestions.find(x=>x.project_name.toLowerCase()===key);
    if(found){ setSelectedProjectPanel(found); setPanelOpen(true); }
  }

  const contentTypes = Array.isArray(settings.content_types) ? settings.content_types : [];
  const channels = Array.isArray(settings.channels) ? settings.channels : [];
  const platforms = Array.isArray(settings.platforms) ? settings.platforms : [];

  return (
    <div className="postform drawer">
      <h3 id="create-post-title">{post.id? 'Edit Post':'Create New Post'}</h3>
      {loadingSettings && <div className="setting-help">Loading form options…</div>}
      {settingsError && <div className="setting-help">{settingsError}</div>}
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

        <select value={post.content_type||''} onChange={e=>setPost({...post, content_type:e.target.value})} disabled={loadingSettings}>
          <option value="">-- Content Type --</option>
          {contentTypes.map((s, index)=> <option key={`${s}-${index}`} value={s}>{s}</option>)}
        </select>

        <div style={{gridColumn:'1 / -1', display:'flex', gap:8, alignItems:'center'}}>
          <select onChange={e=>useTemplate(e.target.value)} defaultValue="" disabled={loadingSettings}>
            <option value="">Use Template</option>
            {templates.map((t,index)=> <option key={t.id ?? index} value={t.id}>{t.name}</option>)}
          </select>
          <button type="button" onClick={saveTemplate}>Save as Template</button>
        </div>

        <select value={post.channel||''} onChange={e=>setPost({...post, channel:e.target.value})} disabled={loadingSettings}>
          <option value="">-- Channel --</option>
          {channels.map((s,index)=> <option key={`${s}-${index}`} value={s}>{s}</option>)}
        </select>
        <select value={post.platform||''} onChange={e=>setPost({...post, platform:e.target.value})} disabled={loadingSettings}>
          <option value="">-- Platform --</option>
          {platforms.map((s,index)=> <option key={`${s}-${index}`} value={s}>{s}</option>)}
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
        {autoFillHint && <div className="autofill-hint">{autoFillHint} <button type="button" onClick={()=>{ setPost({...post, channel:'', platform:''}); setAutoFillHint(null); }}>Undo</button></div>}
        <textarea placeholder="Notes" value={post.notes||''} onChange={e=>setPost({...post, notes:e.target.value})} />
      </div>
      {selectedProjectPanel && (
        <div className="project-panel card">
          <div className="panel-header">
            <strong>Previous schedules for this project</strong>
            <div className="panel-controls">
              <button type="button" onClick={()=>setPanelOpen(!panelOpen)}>{panelOpen? 'Collapse':'Expand'}</button>
              <button type="button" onClick={()=>setSelectedProjectPanel(null)}>Dismiss</button>
            </div>
          </div>
          {panelOpen && (
            <div className="panel-body">
              {Array.isArray(selectedProjectPanel.last_scheduled_dates) && selectedProjectPanel.last_scheduled_dates.map((row, idx)=> (
                <div className="panel-row" key={idx}>{row}</div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="form-actions">
        <button className="btn-primary" type="button" onClick={save}>Save</button>
        <button type="button" onClick={()=>{ setPost(empty); onCancel ? onCancel() : document.getElementById('createModal')?.classList.add('hidden'); }}>Cancel</button>
      </div>
    </div>
  )
}
