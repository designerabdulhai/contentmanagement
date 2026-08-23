import React, {useEffect, useState, useRef} from 'react'
import api from './api'
import LinkActions from './LinkActions'

function toDateTimeLocal(value){
  if(!value) return '';
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return value;
  const pad=(n)=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatSuggestedDate(value){
  if(!value) return '';
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
}

export default function PostForm({onSaved,onCancel}){
  const empty={project_name:'',content_type:'',channel:'',platform:'',status:'Listed',scheduled_at:'',uploaded_link:'',notes:''};
  const [post,setPost]=useState(empty),[settings,setSettings]=useState({}),[suggestions,setSuggestions]=useState([]),[showSuggestions,setShowSuggestions]=useState(false);
  const suggestionsCache=useRef({}), debounceRef=useRef(null);
  const [selectedProjectPanel,setSelectedProjectPanel]=useState(null),[panelOpen,setPanelOpen]=useState(true),[templates,setTemplates]=useState([]),[autoFillHint,setAutoFillHint]=useState(null),[loadingSettings,setLoadingSettings]=useState(true),[settingsError,setSettingsError]=useState('');

  useEffect(()=>{
    let alive=true;
    Promise.all([api.get('/settings'),api.get('/templates').catch(()=>({data:[]}))]).then(([s,t])=>{
      if(!alive)return;
      setSettings(s?.data||{});setTemplates(Array.isArray(t?.data)?t.data:[]);setSettingsError('');
    }).catch(e=>{if(!alive)return;setSettingsError(e?.message||'Could not load form options.');setSettings({});setTemplates([])}).finally(()=>{if(alive)setLoadingSettings(false)});
    const onEdit=e=>setPost({...empty,...(e.detail||{}),scheduled_at:toDateTimeLocal(e.detail?.scheduled_at)});
    window.addEventListener('editPost',onEdit);
    return()=>{alive=false;window.removeEventListener('editPost',onEdit);if(debounceRef.current)clearTimeout(debounceRef.current)};
  },[]);

  const save=()=>{
    const payload={...post,scheduled_at:post.scheduled_at||null};
    const request=post.id?api.put('/posts/'+post.id,payload):api.post('/posts',payload);
    request.then(r=>onSaved&&onSaved(r.data)).catch(()=>{});
  };
  const useTemplate=tId=>{const t=templates.find(x=>x.id==tId);if(t)setPost(p=>({...p,content_type:t.content_type,channel:t.channel,platform:t.platform}))};
  const saveTemplate=()=>{const name=window.prompt('Template name');if(!name)return;api.post('/templates',{name,content_type:post.content_type,channel:post.channel,platform:post.platform}).then(r=>setTemplates(ts=>[r.data,...ts])).catch(()=>{})};
  const onPasteLink=e=>{const pasted=(e.clipboardData||window.clipboardData).getData('text');if(!pasted)return;const u=pasted.toLowerCase();const h=u.includes('youtube.com')||u.includes('youtu.be')?{channel:'YouTube',platform:'Google'}:u.includes('instagram.com')?{channel:'Instagram',platform:'Meta'}:u.includes('tiktok.com')?{channel:'TikTok',platform:'TikTok'}:null;if(h&&(!post.channel||!post.platform)){setPost(p=>({...p,uploaded_link:pasted,channel:p.channel||h.channel,platform:p.platform||h.platform}));setAutoFillHint(`Auto-filled Channel=${h.channel}, Platform=${h.platform} from link`);setTimeout(()=>setAutoFillHint(null),6000)}};

  const queryProjectSuggestions=(q)=>{
    const key=(q||'').trim().toLowerCase();
    if(!key){setSuggestions([]);setShowSuggestions(false);return;}
    if(suggestionsCache.current[key]){setSuggestions(suggestionsCache.current[key]);setShowSuggestions(true);return;}
    api.get('/posts/project-suggestions',{params:{query:q}}).then(res=>{
      const data=Array.isArray(res.data)?res.data:[];
      suggestionsCache.current[key]=data;setSuggestions(data);setShowSuggestions(data.length>0);
    }).catch(()=>{setSuggestions([]);setShowSuggestions(false)});
  };
  const onProjectNameChange=val=>{setPost(p=>({...p,project_name:val}));setSelectedProjectPanel(null);if(debounceRef.current)clearTimeout(debounceRef.current);debounceRef.current=setTimeout(()=>queryProjectSuggestions(val),250)};
  const selectSuggestion=s=>{setPost(p=>({...p,project_name:s.project_name}));setShowSuggestions(false);setSelectedProjectPanel(s);setPanelOpen(true)};
  const maybeShowPanelForName=name=>{const key=(name||'').trim().toLowerCase();const found=suggestionsCache.current[key]||suggestions.find(x=>x.project_name?.toLowerCase()===key);if(found){setSelectedProjectPanel(found);setPanelOpen(true)}};

  const contentTypes=Array.isArray(settings.content_types)?settings.content_types:[];
  const channels=Array.isArray(settings.channels)?settings.channels:[];
  const platforms=Array.isArray(settings.platforms)?settings.platforms:[];

  return <div className="postform">
    <div className="postform-header"><h3 id="create-post-title">{post.id?'Edit Post':'Create New Post'}</h3></div>
    {loadingSettings&&<div className="setting-help">Loading form options…</div>}{settingsError&&<div className="setting-help form-error">{settingsError}</div>}
    <div className="form-grid">
      <div className="project-field">
        <input className="post-input" placeholder="Project Name" value={post.project_name||''} onChange={e=>onProjectNameChange(e.target.value)} onFocus={e=>{if(e.target.value)queryProjectSuggestions(e.target.value)}} onBlur={e=>{setTimeout(()=>maybeShowPanelForName(e.target.value),220)}} />
        {showSuggestions&&suggestions.length>0&&<div className="suggestions-dropdown">
          {suggestions.map(s=><button type="button" key={s.project_name} className="suggestion-item" onMouseDown={e=>e.preventDefault()} onClick={()=>selectSuggestion(s)}>
            <span className="suggestion-name">{s.project_name}</span>
            <span className="suggestion-meta"><span>{s.count} past {s.count===1?'schedule':'schedules'}</span>{s.last_scheduled_at&&<span className="suggestion-date">Last: {formatSuggestedDate(s.last_scheduled_at)}</span>}</span>
          </button>)}
        </div>}
      </div>
      <select className="post-select" value={post.content_type||''} onChange={e=>setPost(p=>({...p,content_type:e.target.value}))} disabled={loadingSettings}><option value="">-- Content Type --</option>{contentTypes.map((s,i)=><option key={`${s}-${i}`} value={s}>{s}</option>)}</select>
      <div className="template-row"><select className="post-select" onChange={e=>useTemplate(e.target.value)} defaultValue="" disabled={loadingSettings}><option value="">Use Template</option>{templates.map((t,i)=><option key={t.id??i} value={t.id}>{t.name}</option>)}</select><button className="btn-secondary" type="button" onClick={saveTemplate}>Save as Template</button></div>
      <select className="post-select" value={post.channel||''} onChange={e=>setPost(p=>({...p,channel:e.target.value}))} disabled={loadingSettings}><option value="">-- Channel --</option>{channels.map((s,i)=><option key={`${s}-${i}`} value={s}>{s}</option>)}</select>
      <select className="post-select" value={post.platform||''} onChange={e=>setPost(p=>({...p,platform:e.target.value}))} disabled={loadingSettings}><option value="">-- Platform --</option>{platforms.map((s,i)=><option key={`${s}-${i}`} value={s}>{s}</option>)}</select>
      <select className="post-select" value={post.status||''} onChange={e=>setPost(p=>({...p,status:e.target.value}))}><option value="Listed">Listed</option><option value="Scheduled">Scheduled</option><option value="Uploaded">Uploaded</option></select>
      <div className="schedule-field"><label htmlFor="schedule-datetime">Schedule Date &amp; Time</label><input className="post-input" id="schedule-datetime" type="datetime-local" value={post.scheduled_at||''} onChange={e=>setPost(p=>({...p,scheduled_at:e.target.value}))}/></div>
      <div className="uploaded-link-field"><input className="post-input" placeholder="Uploaded Link" value={post.uploaded_link||''} onChange={e=>setPost(p=>({...p,uploaded_link:e.target.value}))} onPaste={onPasteLink}/><LinkActions url={post.uploaded_link}/></div>
      {autoFillHint&&<div className="autofill-hint">{autoFillHint}<button type="button" onClick={()=>{setPost(p=>({...p,channel:'',platform:''}));setAutoFillHint(null)}}>Undo</button></div>}
      <textarea className="notes-field post-input" placeholder="Notes" value={post.notes||''} onChange={e=>setPost(p=>({...p,notes:e.target.value}))}/>
    </div>
    {selectedProjectPanel&&<div className="project-panel"><div className="panel-header"><strong>Previous schedules for this project</strong><div className="panel-controls"><button type="button" className="btn-secondary" onClick={()=>setPanelOpen(v=>!v)}>{panelOpen?'Collapse':'Expand'}</button><button type="button" className="btn-secondary" onClick={()=>setSelectedProjectPanel(null)}>Dismiss</button></div></div>{panelOpen&&<div className="panel-body">{(selectedProjectPanel.last_scheduled_dates||[]).map((row,i)=>{const value=typeof row==='string'?row:row?.scheduled_at;return <div className="panel-row" key={i}>{formatSuggestedDate(value)} {typeof row==='object'&&row?.channel?`· ${row.channel}`:''} {typeof row==='object'&&row?.status?`· ${row.status}`:''}</div>})}</div>}</div>}
    <div className="form-actions"><button className="btn-primary" type="button" onClick={save}>Save</button><button className="btn-secondary" type="button" onClick={()=>{setPost(empty);onCancel&&onCancel()}}>Cancel</button></div>
  </div>
}
