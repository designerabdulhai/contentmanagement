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
  const [modalRequest, setModalRequest] = useState(null);

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

  // Cross-page actions: navigate first, then let ListView open its own mounted modal.
  useEffect(()=>{
    const requestPost = () => {
      setRoute('list');
      setModalRequest('post');
    };
    const requestBulk = () => {
      setRoute('list');
      setModalRequest('bulk');
    };
    window.addEventListener('requestNewPost', requestPost);
    window.addEventListener('requestBulkCreate', requestBulk);
    return ()=>{
      window.removeEventListener('requestNewPost', requestPost);
      window.removeEventListener('requestBulkCreate', requestBulk);
    };
  },[])

  useEffect(()=>{
    if(route !== 'list' || !modalRequest) return;
    const request = modalRequest;
    const timer = window.setTimeout(()=>{
      window.dispatchEvent(new CustomEvent(request === 'post' ? 'openPostModal' : 'openBulkModal'));
      setModalRequest(null);
    }, 0);
    return ()=>window.clearTimeout(timer);
  },[route, modalRequest])

  useEffect(()=>{
    const onNavigateToList = ()=>setRoute('list');
    window.addEventListener('navigateToList', onNavigateToList);
    return ()=>window.removeEventListener('navigateToList', onNavigateToList);
  },[])

  useEffect(()=>{
    const onKey = (e)=>{
      if(e.key.toLowerCase()==='n'){
        const active = document.activeElement;
        if(active && (active.tagName==='INPUT' || active.tagName==='TEXTAREA' || active.isContentEditable)) return;
        window.dispatchEvent(new CustomEvent('requestNewPost'));
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
    </div>
  )
}
