import React, {useEffect, useMemo, useState} from 'react'
import api from '../api'
import PostForm from '../components/PostForm'
import LinkActions from '../components/LinkActions'

const STATUS_OPTIONS = ['Listed','Scheduled','Uploaded'];
const WORKER_URL = 'https://contentmanagement-api.rubel-bhd1.workers.dev';
const TOKEN_KEY = 'content_schedule_auth_token';

function formatDayLabel(value){
  if(!value) return 'No date';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'No date' : d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'});
}

function formatTime(value){
  if(!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
}

async function deleteFromWorker(id) {
  const token = localStorage.getItem(TOKEN_KEY) || '';
  const headers = {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const attempts = [
    { method: 'POST', path: `/api/posts/${encodeURIComponent(id)}/delete` },
    { method: 'POST', path: `/api/posts/${encodeURIComponent(id)}/remove` },
    { method: 'DELETE', path: `/api/posts/${encodeURIComponent(id)}` },
  ];

  const errors = [];

  for (const attempt of attempts) {
    try {
      const response = await fetch(`${WORKER_URL}${attempt.path}`, {
        method: attempt.method,
        headers,
        redirect: 'follow',
      });

      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }

      if (response.ok && (data?.deleted === true || data?.ok === true)) {
        return data;
      }

      const message = data?.error || data?.message || text || `HTTP ${response.status}`;
      errors.push(`${attempt.method} ${attempt.path}: ${message}`);
    } catch (error) {
      errors.push(`${attempt.method} ${attempt.path}: ${error?.message || error}`);
    }
  }

  throw new Error(errors.join(' | '));
}

export default function ListView(){
  const [posts, setPosts] = useState([]);
  const [filters, setFilters] = useState({search:'', channel:'', content_type:'', status:''});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(null);
  const [deletingPostId, setDeletingPostId] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [groupByDate, setGroupByDate] = useState(true);

  useEffect(()=>{
    load();
    const onOpen = ()=>setShowCreateModal(true);
    const onNav = ()=>{
      if(localStorage.getItem('list_filter_dueSoon')){
        setFilters(f=>({...f, dueSoon:true}));
        localStorage.removeItem('list_filter_dueSoon');
      }
    };
    window.addEventListener('openPostModal', onOpen);
    window.addEventListener('openPostModalOnly', onOpen);
    window.addEventListener('navigateToList', onNav);
    return ()=>{
      window.removeEventListener('openPostModal', onOpen);
      window.removeEventListener('openPostModalOnly', onOpen);
      window.removeEventListener('navigateToList', onNav);
    };
  },[])

  const currentUserId = 1;
  const [myPostsOnly, setMyPostsOnly] = useState(localStorage.getItem('my_posts')==='1');
  const load = ()=> api.get('/posts').then(r=> setPosts(Array.isArray(r.data)?r.data:[])).catch(()=>setPosts([]));

  const deletePost = async (id)=>{
    if (!id || deletingPostId) return;
    setDeleteError('');
    setDeletingPostId(id);
    try {
      await deleteFromWorker(id);
      setPosts(current => current.filter(post => Number(post.id) !== Number(id)));
    } catch (error) {
      setDeleteError(error?.message || 'Unable to delete post');
      await load();
    } finally {
      setDeletingPostId(null);
    }
  };

  const filteredPosts = useMemo(()=>posts.filter(p=>
    (!filters.search || (p.project_name||'').toLowerCase().includes(filters.search.toLowerCase())) &&
    (!filters.channel || p.channel===filters.channel) &&
    (!filters.content_type || p.content_type===filters.content_type) &&
    (!filters.status || p.status===filters.status) &&
    (!myPostsOnly || p.created_by==currentUserId)
  ),[posts,filters,myPostsOnly]);

  const groups = useMemo(()=>{
    const map = {};
    filteredPosts.forEach(post=>{
      const key = post.scheduled_at ? formatDayLabel(post.scheduled_at) : 'No date';
      (map[key] ||= []).push(post);
    });
    return Object.entries(map).sort((a,b)=>{
      if(a[0]==='No date') return 1;
      if(b[0]==='No date') return -1;
      return new Date(a[1][0]?.scheduled_at||0)-new Date(b[1][0]?.scheduled_at||0);
    });
  },[filteredPosts]);

  const changeStatus = async (post, status)=>{
    if(!post?.id || !status || status===post.status) return;
    setUpdatingStatus(post.id);
    try{
      const r = await api.put('/posts/'+post.id, {...post, status});
      const updated = r?.data || {...post,status};
      setPosts(current=>current.map(item=>item.id===post.id?updated:item));
    }catch(e){}
    finally{ setUpdatingStatus(null); }
  };

  const actionButtons = (p) => (
    <td className="actions">
      <button type="button" title="Edit" onClick={()=>window.dispatchEvent(new CustomEvent('editPost',{detail:p}))}>✏️</button>
      <button type="button" title="Duplicate" onClick={()=>api.post('/posts/'+p.id+'/duplicate').then(()=>load()).catch(()=>{})}>⎘</button>
      <button
        type="button"
        title="Delete"
        aria-label={`Delete ${p.project_name || 'post'}`}
        disabled={deletingPostId===p.id || deletingPostId!==null}
        onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); deletePost(p.id); }}
      >{deletingPostId===p.id ? '…' : '🗑️'}</button>
    </td>
  );

  return (
    <div className="page listview">
      <div className="list-header">
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <input className="search" placeholder="Search posts" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})} />
          <button className={myPostsOnly?'active':''} type="button" onClick={()=>{ setMyPostsOnly(s=>{ const v=!s; localStorage.setItem('my_posts',v?'1':'0'); return v; }); }}>My Posts</button>
          <button className={groupByDate?'active':''} type="button" onClick={()=>setGroupByDate(v=>!v)}>{groupByDate?'Date grouped':'Table view'}</button>
        </div>
        <div className="list-actions">
          <button className="list-tool-btn" type="button">Sort</button>
          <button className="list-tool-btn" type="button">Filters</button>
          <button className="btn-secondary" type="button" onClick={()=>window.dispatchEvent(new CustomEvent('requestBulkCreate'))}>Bulk</button>
          <button className="btn-primary" type="button" onClick={()=>setShowCreateModal(true)}>
            <span className="new-post-plus">+</span> New Scheduled Post <span className="fab-shortcut">N</span>
          </button>
        </div>
      </div>

      {deleteError && <div className="card" style={{marginBottom:12,padding:'10px 14px',color:'#b42318',background:'#fff1f0'}}>{deleteError}</div>}

      {groupByDate ? (
        <div className="date-groups">
          {groups.map(([day, items])=>(
            <section className="date-group" key={day}>
              <div className="date-group-header">
                <div>
                  <h3>{day}</h3>
                  <span>{items.length} {items.length===1?'post':'posts'}</span>
                </div>
              </div>
              <div className="table-wrap card date-group-table">
                <table className="posts">
                  <thead><tr><th>Project</th><th>Type</th><th>Channel</th><th>Platform</th><th>Status</th><th>Time</th><th>Uploaded Link</th><th>Owner</th><th>Actions</th></tr></thead>
                  <tbody>
                    {items.map(p=>(
                      <tr key={p.id}>
                        <td>{p.project_name}</td>
                        <td>{p.content_type}</td>
                        <td>{p.channel}</td>
                        <td>{p.platform}</td>
                        <td>
                          <select className={`inline-status ${p.status?.toLowerCase()||''}`} value={p.status||''} onChange={e=>changeStatus(p,e.target.value)} disabled={updatingStatus===p.id}>
                            {STATUS_OPTIONS.map(status=><option key={status} value={status}>{status}</option>)}
                          </select>
                        </td>
                        <td>{formatTime(p.scheduled_at)}</td>
                        <td><div style={{display:'flex',alignItems:'center',gap:8}}><div className="link-text" title={p.uploaded_link||''}>{p.uploaded_link||''}</div><LinkActions url={p.uploaded_link} /></div></td>
                        <td>{p.owner}</td>
                        {actionButtons(p)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {groups.length===0 && <div className="card empty-state">No posts found.</div>}
        </div>
      ) : (
        <div className="table-wrap card">
          <table className="posts">
            <thead><tr><th>Project</th><th>Type</th><th>Channel</th><th>Platform</th><th>Status</th><th>Date</th><th>Uploaded Link</th><th>Owner</th><th>Actions</th></tr></thead>
            <tbody>
              {filteredPosts.map(p=>(
                <tr key={p.id}>
                  <td>{p.project_name}</td><td>{p.content_type}</td><td>{p.channel}</td><td>{p.platform}</td>
                  <td><select className={`inline-status ${p.status?.toLowerCase()||''}`} value={p.status||''} onChange={e=>changeStatus(p,e.target.value)} disabled={updatingStatus===p.id}>{STATUS_OPTIONS.map(status=><option key={status} value={status}>{status}</option>)}</select></td>
                  <td>{p.scheduled_at}</td>
                  <td><div style={{display:'flex',alignItems:'center',gap:8}}><div className="link-text" title={p.uploaded_link||''}>{p.uploaded_link||''}</div><LinkActions url={p.uploaded_link} /></div></td>
                  <td>{p.owner}</td>
                  {actionButtons(p)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateModal && (
        <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setShowCreateModal(false)}}>
          <div className="modal create-post-modal" role="dialog" aria-modal="true">
            <PostForm onSaved={()=>{setShowCreateModal(false);load()}} onCancel={()=>setShowCreateModal(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
