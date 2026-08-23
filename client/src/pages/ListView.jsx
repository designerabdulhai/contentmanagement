import React, {useEffect, useState} from 'react'
import api from '../api'
import PostForm from '../components/PostForm'
import LinkActions from '../components/LinkActions'

export default function ListView(){
  const [posts, setPosts] = useState([]);
  const [filters, setFilters] = useState({search:'', channel:'', content_type:'', status:''});

  useEffect(()=>{ load();
    const onOpen = ()=>document.getElementById('createModal')?.classList.remove('hidden');
    const onOpenOnly = ()=>document.getElementById('createModal')?.classList.remove('hidden');
    window.addEventListener('openPostModal', onOpen);
    window.addEventListener('openPostModalOnly', onOpenOnly);
    const onNav = ()=>{
      if(localStorage.getItem('list_filter_dueSoon')){ setFilters(f=>({...f, dueSoon:true})); localStorage.removeItem('list_filter_dueSoon'); }
    }
    return ()=>{
      window.removeEventListener('openPostModal', onOpen);
      window.removeEventListener('openPostModalOnly', onOpenOnly);
      window.removeEventListener('navigateToList', onNav);
    };
  },[])

  const currentUserId = 1;
  const [myPostsOnly, setMyPostsOnly] = useState(localStorage.getItem('my_posts')==='1');
  const load = ()=> api.get('/posts').then(r=> setPosts(r.data)).catch(()=>{});
  const deletePost = (id)=>{ api.delete('/posts/'+id).then(()=>load()); }

  return (
    <div className="page listview">
      <div className="list-header">
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <input className="search" placeholder="Search posts" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})} />
          <button className={myPostsOnly? 'active':''} type="button" onClick={()=>{ setMyPostsOnly(s=>{ const v=!s; localStorage.setItem('my_posts', v?'1':'0'); return v; }); }}>My Posts</button>
        </div>
        <div className="list-actions">
          <button className="list-tool-btn" type="button">Sort</button>
          <button className="list-tool-btn" type="button">Filters</button>
          <button className="btn-secondary" type="button" onClick={()=>window.dispatchEvent(new CustomEvent('openBulkModal'))}>Bulk</button>
          <button className="btn-primary" type="button" onClick={()=>document.getElementById('createModal')?.classList.remove('hidden')}>
            <span className="new-post-plus">+</span> New Scheduled Post <span className="fab-shortcut">N</span>
          </button>
        </div>
      </div>

      <div className="table-wrap card">
        <table className="posts">
          <thead><tr><th>Project</th><th>Type</th><th>Channel</th><th>Platform</th><th>Status</th><th>Date</th><th>Uploaded Link</th><th>Owner</th><th>Actions</th></tr></thead>
          <tbody>
            {posts.filter(p=> (!filters.search || (p.project_name||'').toLowerCase().includes(filters.search.toLowerCase())) && (!myPostsOnly || p.created_by==currentUserId)).map(p=> (
              <tr key={p.id}>
                <td>{p.project_name}</td>
                <td>{p.content_type}</td>
                <td>{p.channel}</td>
                <td>{p.platform}</td>
                <td><span className={"status-pill "+(p.status?.toLowerCase()||'')}>{p.status}</span></td>
                <td>{p.scheduled_at}</td>
                <td>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div className="link-text" title={p.uploaded_link||''}>{p.uploaded_link||''}</div>
                      <LinkActions url={p.uploaded_link} />
                  </div>
                </td>
                <td>{p.owner}</td>
                <td className="actions">
                  <button type="button" title="Edit" onClick={()=>window.dispatchEvent(new CustomEvent('editPost',{detail:p}))}>✏️</button>
                  <button type="button" title="Duplicate" onClick={()=>api.post('/posts/'+p.id+'/duplicate').then(()=>load())}>⎘</button>
                  <button type="button" title="Delete" onClick={()=>deletePost(p.id)}>🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div id="createModal" className="modal hidden">
        <PostForm onSaved={()=>{ document.getElementById('createModal').classList.add('hidden'); load(); }} />
      </div>

    </div>
  )
}
