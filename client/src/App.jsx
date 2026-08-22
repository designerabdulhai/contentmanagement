import React, {useState, useEffect} from 'react'
import Dashboard from './pages/Dashboard'
import ListView from './pages/ListView'
import Settings from './pages/Settings'
import CalendarView from './pages/CalendarView'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import api from './api'

const defaultProfile = { name: 'Owner Name', email: '', photo: '' };

function profileFromSettings(data){
  return {
    name: data.profile_name?.[0] || defaultProfile.name,
    email: data.profile_email?.[0] || '',
    photo: data.profile_photo?.[0] || '',
  };
}

export default function App(){
  const [route, setRoute] = useState('dashboard');
  const [managers, setManagers] = useState([]);
  const [theme, setTheme] = useState('light');
  const [profile, setProfile] = useState(defaultProfile);

  const loadProfile = () => api.get('/settings').then(r => setProfile(profileFromSettings(r.data))).catch(()=>{});

  useEffect(()=>{
    api.get('/invites').then(r=>setManagers(r.data)).catch(()=>{});
    loadProfile();
  },[])

  useEffect(()=>{
    const onProfileUpdated = (e) => setProfile(e.detail || defaultProfile);
    window.addEventListener('profileUpdated', onProfileUpdated);
    return ()=>window.removeEventListener('profileUpdated', onProfileUpdated);
  },[])

  useEffect(()=>{
    const onKey = (e)=>{
      if(e.key.toLowerCase()==='n'){
        const active = document.activeElement;
        if(active && (active.tagName==='INPUT' || active.tagName==='TEXTAREA' || active.isContentEditable)) return;
        window.dispatchEvent(new CustomEvent('openPostModal'));
      }
      if(e.key==='?') alert('Keyboard shortcuts:\nN — New post\n? — Help');
    }
    window.addEventListener('keydown', onKey);
    return ()=>window.removeEventListener('keydown', onKey);
  },[])

  useEffect(()=>{ document.documentElement.setAttribute('data-theme', theme); },[theme])

  return (
    <div className="app-root layout-root">
      <Sidebar route={route} setRoute={setRoute} theme={theme} setTheme={setTheme} />
      <div className="main-area">
        <Topbar title={route==='dashboard'? 'Dashboard' : route==='list'? 'All Posts' : route==='settings'? 'Settings' : 'Calendar'} managers={managers} profile={profile} />
        <main className="main-content">
          {route==='dashboard' && <Dashboard />}
          {route==='list' && <ListView />}
          {route==='settings' && <Settings />}
          {route==='calendar' && <CalendarView />}
        </main>
      </div>
      <div style={{position:'fixed',right:28,bottom:28,display:'flex',flexDirection:'column',gap:8,alignItems:'flex-end'}}>
        <button className="fab" onClick={()=>window.dispatchEvent(new CustomEvent('openBulkModal'))} title="Bulk Create">Bulk</button>
        <button className="fab" onClick={()=>window.dispatchEvent(new CustomEvent('openPostModal'))} title="New Scheduled Post">
          <span className="fab-icon">+</span><span className="fab-label">New Scheduled Post</span><span className="fab-shortcut">N</span>
        </button>
      </div>
      <div id="bulkModal" className="modal hidden">{/* Bulk modal rendered by event listener in App mount */}</div>
    </div>
  )
}
