import React, {useEffect, useMemo, useState} from 'react'
import api from '../api'
import PostForm from '../components/PostForm'
import LinkActions from '../components/LinkActions'

const STATUS_OPTIONS = ['Listed','Scheduled','Uploaded'];
const TOKEN_KEY = 'content_schedule_auth_token';

function toDate(value){
  if(!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDayLabel(value){
  const d = toDate(value);
  if(!d) return 'No date';
  return d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'});
}

function formatTime(value){
  const d = toDate(value);
  return d ? d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : '';
}

function formatDateTime(value){
  const d = toDate(value);
  return d ? d.toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : '';
}

function statusKey(status){
  const s = String(status || '').trim().toLowerCase();
  if(s.includes('upload')) return 'uploaded';
  if(s.includes('post') || s.includes('publish')) return 'posted';
  if(s.includes('sched')) return 'scheduled';
  if(s.includes('list')) return 'listed';
  return '';
}

function firstDate(post, keys){
  for(const key of keys){
    const d = toDate(post?.[key]);
    if(d) return d;
  }
  return null;
}

function getPostEvents(post){
  const status = statusKey(post?.status);
  const scheduled = firstDate(post, ['scheduled_at']);
  const uploaded = firstDate(post, [
    'uploaded_at','uploadedAt',
    'upload_time','uploadTime',
    'uploaded_time','uploadedTime',
    'upload_at','uploadAt',
  ]);
  const posted = firstDate(post, [
    'posted_at','postedAt',
    'published_at','publishedAt',
    'post_time','postTime',
    'published_time','publishedTime',
  ]);
  const created = firstDate(post, ['created_at','createdAt']);
  const updated = firstDate(post, ['updated_at','updatedAt']);

  // The list should show only the date/time relevant to the CURRENT status.
  // Uploaded posts use their upload timestamp; scheduled posts use scheduled_at.
  if(status === 'uploaded'){
    const date = uploaded || updated;
    return date ? [{type:'uploaded', label:'Uploaded', date}] : [];
  }

  if(status === 'scheduled'){
    return scheduled ? [{type:'scheduled', label:'Scheduled', date:scheduled}] : [];
  }

  if(status === 'posted'){
    const date = posted || updated || created;
    return date ? [{type:'posted', label:'Posted', date}] : [];
  }

  if(status === 'listed'){
    const date = created || updated;
    return date ? [{type:'listed', label:'Listed', date}] : [];
  }

  return [];
}

function displayDate(post){
  return getPostEvents(post)[0]?.date || null;
}

function PostTimes({post}){
  const events = getPostEvents(post);
  if(!events.length) return <span className="post-time-empty">No time</span>;
  const event = events[0];
  return (
    <div className="post-time-stack">
      <span title={formatDateTime(event.date)}>
        <strong>{event.label}</strong> {formatDateTime(event.date)}
      </span>
    </div>
  );
}

function startOfWeek(date){
  const d = new Date(date);
  d.setHours(0,0,0,0);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d;
}

function startOfMonth(date){
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(1);
  return d;
}

export default function ListView(){
  const [posts, setPosts] = useState([]);
  const [filters, setFilters] = useState({search:'', channel:'', content_type:'', status:'', period:'all'});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(null);
  const [deletingPostId, setDeletingPostId] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [groupByDate, setGroupByDate] = useState(true);
  const currentUserId = 1;
  const [myPostsOnly, setMyPostsOnly] = useState(localStorage.getItem('my_posts')==='1');

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
  },[]);

  const load = ()=> api.get('/posts').then(r=>setPosts(Array.isArray(r.data)?r.data:[])).catch(()=>setPosts([]));

  const deletePost = async (id)=>{
    if(!id || deletingPostId) return;
    setDeleteError('');
    setDeletingPostId(id);
    try{
      const token = localStorage.getItem(TOKEN_KEY) || '';
      const response = await fetch(`/api/posts/${encodeURIComponent(id)}`, {
        method:'DELETE',
        headers:{Accept:'application/json', ...(token?{Authorization:`Bearer ${token}`}:{})},
      });
      const text = await response.text();
      let data = null;
      try{ data = text ? JSON.parse(text) : null; }catch{ data = null; }
      if(!response.ok || !data?.deleted){
        throw new Error(data?.error || data?.message || text || `Delete failed (${response.status})`);
      }
      setPosts(current=>current.filter(post=>Number(post.id)!==Number(id)));
    }catch(error){
      setDeleteError(error?.message || 'Unable to delete post');
      await load();
    }finally{
      setDeletingPostId(null);
    }
  };

  const filteredPosts = useMemo(()=>{
    const now = new Date();
    const weekStart = startOfWeek(now);
    const nextWeek = new Date(weekStart);
    nextWeek.setDate(nextWeek.getDate()+7);
    const monthStart = startOfMonth(now);
    const nextMonth = new Date(monthStart);
    nextMonth.setMonth(nextMonth.getMonth()+1);

    return posts.filter(p=>{
      const events = getPostEvents(p);
      const inPeriod = filters.period==='all'
        ? true
        : events.some(event=>event.date >= (filters.period==='week' ? weekStart : monthStart) && event.date < (filters.period==='week' ? nextWeek : nextMonth));

      return (
        (!filters.search || (p.project_name||'').toLowerCase().includes(filters.search.toLowerCase())) &&
        (!filters.channel || p.channel===filters.channel) &&
        (!filters.content_type || p.content_type===filters.content_type) &&
        (!filters.status || p.status===filters.status) &&
        (!myPostsOnly || p.created_by==currentUserId) &&
        inPeriod
      );
    });
  },[posts,filters,myPostsOnly]);

  const groups = useMemo(()=>{
    const map = {};
    filteredPosts.forEach(post=>{
      const primary = displayDate(post);
      const key = primary ? formatDayLabel(primary) : 'No date';
      (map[key] ||= []).push(post);
    });
    return Object.entries(map).sort((a,b)=>{
      if(a[0]==='No date') return 1;
      if(b[0]==='No date') return -1;
      const ad = displayDate(a[1][0]) || new Date(0);
      const bd = displayDate(b[1][0]) || new Date(0);
      return bd-ad;
    });
  },[filteredPosts]);

  const changeStatus = async (post,status)=>{
    if(!post?.id || !status || status===post.status) return;
    setUpdatingStatus(post.id);
    try{
      const r = await api.put('/posts/'+post.id,{...post,status});
      const updated = r?.data || {...post,status};
      setPosts(current=>current.map(item=>item.id===post.id?updated:item));
    }catch(e){}
    finally{setUpdatingStatus(null)}
  };

  const actionButtons = p => (
    <td className="actions">
      <button type="button" title="Edit" onClick={()=>window.dispatchEvent(new CustomEvent('editPost',{detail:p}))}>✏️</button>
      <button type="button" title="Duplicate" onClick={()=>api.post('/posts/'+p.id+'/duplicate').then(()=>load()).catch(()=>{})}>⎘</button>
      <button type="button" title="Delete" aria-label={`Delete ${p.project_name || 'post'}`} disabled={deletingPostId===p.id || deletingPostId!==null} onClick={e=>{e.preventDefault();e.stopPropagation();deletePost(p.id)}}>{deletingPostId===p.id?'…':'🗑️'}</button>
    </td>
  );

  return (
    <div className="page listview">
      <div className="list-header">
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <input className="search" placeholder="Search posts" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/>
          <button className={myPostsOnly?'active':''} type="button" onClick={()=>setMyPostsOnly(s=>{const v=!s;localStorage.setItem('my_posts',v?'1':'0');return v})}>My Posts</button>
          <button className={groupByDate?'active':''} type="button" onClick={()=>setGroupByDate(v=>!v)}>{groupByDate?'Date grouped':'Table view'}</button>
        </div>
        <div className="list-actions">
          <button className="list-tool-btn" type="button">Sort</button>
          <button className={`list-tool-btn ${filters.period!=='all'?'active':''}`} type="button" onClick={()=>setFilters(f=>({...f,period:f.period==='all'?'week':f.period==='week'?'month':'all'}))} title="Filter by week or month">
            {filters.period==='week'?'This Week':filters.period==='month'?'This Month':'Filters'}
          </button>
          <button className="btn-secondary" type="button" onClick={()=>window.dispatchEvent(new CustomEvent('requestBulkCreate'))}>Bulk</button>
          <button className="btn-primary" type="button" onClick={()=>setShowCreateModal(true)}><span className="new-post-plus">+</span> New Scheduled Post <span className="fab-shortcut">N</span></button>
        </div>
      </div>

      <div style={{display:'flex',justifyContent:'flex-end',gap:6,marginBottom:10}}>
        {[
          ['all','All'],
          ['week','This Week'],
          ['month','This Month'],
        ].map(([value,label])=>(
          <button key={value} type="button" className={filters.period===value?'active':''} onClick={()=>setFilters(f=>({...f,period:value}))} style={{padding:'6px 10px',borderRadius:8,border:'1px solid #ddd',background:filters.period===value?'#eeeaff':'#fff',fontWeight:600}}>{label}</button>
        ))}
      </div>

      {deleteError && <div className="card" style={{marginBottom:12,padding:'10px 14px',color:'#b42318',background:'#fff1f0'}}>{deleteError}</div>}

      {groupByDate ? (
        <div className="date-groups">
          {groups.map(([day,items])=>(
            <section className="date-group" key={day}>
              <div className="date-group-header"><div><h3>{day}</h3><span>{items.length} {items.length===1?'post':'posts'}</span></div></div>
              <div className="table-wrap card date-group-table">
                <table className="posts">
                  <thead><tr><th>Project</th><th>Type</th><th>Channel</th><th>Platform</th><th>Status</th><th>Time</th><th>Uploaded Link</th><th>Owner</th><th>Actions</th></tr></thead>
                  <tbody>{items.map(p=>(
                    <tr key={p.id}>
                      <td>{p.project_name}</td><td>{p.content_type}</td><td>{p.channel}</td><td>{p.platform}</td>
                      <td><select className={`inline-status ${p.status?.toLowerCase()||''}`} value={p.status||''} onChange={e=>changeStatus(p,e.target.value)} disabled={updatingStatus===p.id}>{STATUS_OPTIONS.map(status=><option key={status} value={status}>{status}</option>)}</select></td>
                      <td><PostTimes post={p}/></td>
                      <td><div style={{display:'flex',alignItems:'center',gap:8}}><div className="link-text" title={p.uploaded_link||''}>{p.uploaded_link||''}</div><LinkActions url={p.uploaded_link}/></div></td>
                      <td>{p.owner}</td>
                      {actionButtons(p)}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          ))}
          {groups.length===0 && <div className="card empty-state">No posts found.</div>}
        </div>
      ) : (
        <div className="table-wrap card">
          <table className="posts">
            <thead><tr><th>Project</th><th>Type</th><th>Channel</th><th>Platform</th><th>Status</th><th>Date / Time</th><th>Uploaded Link</th><th>Owner</th><th>Actions</th></tr></thead>
            <tbody>{filteredPosts.map(p=>(
              <tr key={p.id}>
                <td>{p.project_name}</td><td>{p.content_type}</td><td>{p.channel}</td><td>{p.platform}</td>
                <td><select className={`inline-status ${p.status?.toLowerCase()||''}`} value={p.status||''} onChange={e=>changeStatus(p,e.target.value)} disabled={updatingStatus===p.id}>{STATUS_OPTIONS.map(status=><option key={status} value={status}>{status}</option>)}</select></td>
                <td><PostTimes post={p}/></td>
                <td><div style={{display:'flex',alignItems:'center',gap:8}}><div className="link-text" title={p.uploaded_link||''}>{p.uploaded_link||''}</div><LinkActions url={p.uploaded_link}/></div></td>
                <td>{p.owner}</td>{actionButtons(p)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {showCreateModal && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setShowCreateModal(false)}}><div className="modal create-post-modal" role="dialog" aria-modal="true"><PostForm onSaved={()=>{setShowCreateModal(false);load()}} onCancel={()=>setShowCreateModal(false)}/></div></div>}
    </div>
  )
}
