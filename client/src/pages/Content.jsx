import React, {useEffect, useMemo, useState} from 'react'
import api from '../api'

const VIDEO_STATUSES = ['Record','Running','Editing Done','Upload']
const POSTER_STATUSES = ['Design','Upload']
const VIDEO_FIELDS = [
  ['full_video','Full Video'],
  ['short_ex','Short Ex'],
  ['short_top','Short Top'],
  ['style_ex','Style Ex'],
  ['style_top','Style Top'],
]

function emptyContent(){
  return {
    name:'',
    full_video_status:'', short_ex_status:'', short_top_status:'', style_ex_status:'', style_top_status:'',
    poster_status:'',
    document_link:'',
    file_path:''
  }
}

function stageOf(item){
  if (VIDEO_FIELDS.every(([key]) => item?.[`${key}_status`] === 'Upload')) return 'uploaded'
  if (item?.full_video_status === 'Record' || item?.full_video_status === 'Running' || item?.full_video_status === 'Editing Done') return 'running'
  return 'ready'
}

function StatusSelect({value, options, onChange}){
  return <select className={`content-status content-status-${String(value || 'empty').toLowerCase().replace(/\s+/g,'-')}`} value={value || ''} onChange={e=>onChange(e.target.value)}>
    <option value="">Not set</option>
    {options.map(option=><option key={option} value={option}>{option}</option>)}
  </select>
}

function StatusCell({item, field, status, onStatus}){
  return <div className="content-status-cell">
    <StatusSelect value={status} options={field === 'poster' ? POSTER_STATUSES : VIDEO_STATUSES} onChange={value=>onStatus(item, `${field}_status`, value)} />
  </div>
}

async function copyPath(path){
  const value = String(path || '').trim()
  if (!value) return
  try{
    await navigator.clipboard.writeText(value)
  }catch{
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
}

export default function Content(){
  const [items,setItems] = useState([])
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [search,setSearch] = useState('')
  const [tab,setTab] = useState('all')
  const [showModal,setShowModal] = useState(false)
  const [editing,setEditing] = useState(null)
  const [saving,setSaving] = useState(false)

  const load = () => api.get('/contents').then(r=>setItems(Array.isArray(r.data)?r.data:[])).catch(e=>setError(e.message || 'Unable to load content')).finally(()=>setLoading(false))
  useEffect(()=>{ load() },[])

  const counts = useMemo(()=>items.reduce((acc,item)=>{acc[stageOf(item)] += 1; return acc},{ready:0,running:0,uploaded:0}),[items])

  const visible = useMemo(()=>{
    const q = search.trim().toLowerCase()
    return items.filter(item=>{
      const matchesTab = tab === 'all' || stageOf(item) === tab
      const matchesSearch = !q || [item.name,item.document_link,item.file_path].some(v=>String(v||'').toLowerCase().includes(q))
      return matchesTab && matchesSearch
    })
  },[items,tab,search])

  const save = async (payload) => {
    setSaving(true); setError('')
    try{
      const r = editing ? await api.put(`/contents/${editing.id}`, payload) : await api.post('/contents', payload)
      setItems(current=>editing ? current.map(item=>item.id===editing.id?r.data:item) : [r.data,...current])
      setShowModal(false); setEditing(null)
    }catch(e){ setError(e.message || 'Unable to save content') }
    finally{ setSaving(false) }
  }

  const updateStatus = async (item, field, value) => {
    setError('')
    const next = {...item,[field]:value}
    setItems(current=>current.map(row=>row.id===item.id?next:row))
    try{
      const r = await api.put(`/contents/${item.id}`, next)
      setItems(current=>current.map(row=>row.id===item.id?r.data:row))
    }catch(e){
      setItems(current=>current.map(row=>row.id===item.id?item:row))
      setError(e.message || 'Unable to update status')
    }
  }

  return <div className="page content-page">
    <div className="content-header">
      <div>
        <h2>Content</h2>
        <p>Manage video production from ready to uploaded.</p>
      </div>
      <button className="btn-primary" type="button" onClick={()=>{setEditing(null);setShowModal(true)}}>+ Add New Content</button>
    </div>

    <div className="content-toolbar">
      <input className="search content-search" placeholder="Search content" value={search} onChange={e=>setSearch(e.target.value)} />
      <div className="content-tabs" role="tablist">
        {[
          ['all','All',items.length],
          ['ready','Video Ready',counts.ready],
          ['running','Running',counts.running],
          ['uploaded','Uploaded',counts.uploaded]
        ].map(([key,label,count])=><button key={key} className={tab===key?'active':''} type="button" onClick={()=>setTab(key)}>{label}<span>{count}</span></button>)}
      </div>
    </div>

    {error && <div className="content-error">{error}</div>}
    <div className="table-wrap card content-table-wrap">
      {loading ? <div className="content-empty">Loading content…</div> : visible.length===0 ? <div className="content-empty">No content found.</div> :
      <table className="content-table"><thead><tr>
        <th>Name</th><th>Full Video</th><th>Short Ex</th><th>Short Top</th><th>Style Ex</th><th>Style Top</th><th>Poster</th><th>Actions</th>
      </tr></thead><tbody>{visible.map(item=><tr key={item.id}>
        <td className="content-name">{item.name}</td>
        <td><StatusCell item={item} field="full_video" status={item.full_video_status} onStatus={updateStatus} /></td>
        <td><StatusCell item={item} field="short_ex" status={item.short_ex_status} onStatus={updateStatus} /></td>
        <td><StatusCell item={item} field="short_top" status={item.short_top_status} onStatus={updateStatus} /></td>
        <td><StatusCell item={item} field="style_ex" status={item.style_ex_status} onStatus={updateStatus} /></td>
        <td><StatusCell item={item} field="style_top" status={item.style_top_status} onStatus={updateStatus} /></td>
        <td><StatusCell item={item} field="poster" status={item.poster_status} onStatus={updateStatus} /></td>
        <td className="actions content-actions">
          <button type="button" title={item.document_link ? 'Open Document' : 'Document link not set'} disabled={!item.document_link} onClick={()=>item.document_link && window.open(item.document_link,'_blank','noopener,noreferrer')}>↗</button>
          <button type="button" title={item.file_path ? 'Copy Path' : 'File path not set'} disabled={!item.file_path} onClick={()=>copyPath(item.file_path)}>⧉</button>
          <button type="button" title="Edit" onClick={()=>{setEditing(item);setShowModal(true)}}>✏️</button>
        </td>
      </tr>)}</tbody></table>}
    </div>

    {showModal && <ContentModal initial={editing || emptyContent()} saving={saving} onCancel={()=>{setShowModal(false);setEditing(null)}} onSave={save} />}
  </div>
}

function ContentModal({initial,saving,onCancel,onSave}){
  const [form,setForm] = useState(initial)
  const set = (key,value)=>setForm(current=>({...current,[key]:value}))
  const submit = e => { e.preventDefault(); if(!form.name.trim()) return; onSave(form) }
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onCancel()}}>
    <div className="modal content-modal" role="dialog" aria-modal="true">
      <div className="content-modal-head"><div><h3>{initial.id?'Edit Content':'Add New Content'}</h3><p>Statuses control which tab the content appears in.</p></div><button type="button" className="modal-close" onClick={onCancel}>×</button></div>
      <form onSubmit={submit}>
        <label className="content-field"><span>Name</span><input value={form.name||''} onChange={e=>set('name',e.target.value)} placeholder="Content name" autoFocus /></label>
        <div className="content-form-grid">
          {VIDEO_FIELDS.map(([key,label])=><label className="content-field" key={key}><span>{label} Status</span><StatusSelect value={form[`${key}_status`]} options={VIDEO_STATUSES} onChange={value=>set(`${key}_status`,value)} /></label>)}
          <label className="content-field"><span>Poster Status</span><StatusSelect value={form.poster_status} options={POSTER_STATUSES} onChange={value=>set('poster_status',value)} /></label>
        </div>
        <div className="content-form-links">
          <label className="content-field"><span>Document Link</span><input value={form.document_link||''} onChange={e=>set('document_link',e.target.value)} placeholder="Document URL" /></label>
          <label className="content-field"><span>File Path</span><input value={form.file_path||''} onChange={e=>set('file_path',e.target.value)} placeholder="File path" /></label>
        </div>
        <div className="content-modal-actions"><button className="btn-secondary" type="button" onClick={onCancel}>Cancel</button><button className="btn-primary" type="submit" disabled={saving || !form.name.trim()}>{saving?'Saving…':initial.id?'Save Changes':'Add Content'}</button></div>
      </form>
    </div>
  </div>
}
