import React, {useState, useEffect} from 'react'
import Dashboard from './pages/Dashboard'
import ListView from './pages/ListView'
import Settings from './pages/Settings'
import CalendarView from './pages/CalendarView'
import Login from './pages/Login'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import api, { TOKEN_KEY } from './api'

const defaultProfile = { name: 'Owner Name', email: '', photo: '' };
const ROUTES = new Set(['dashboard','list','calendar','settings']);
const ACTIVE_ROUTE_KEY = 'content_schedule_active_route';

function profileFromSettings(data){
  return { name: data.profile_name?.[0] || defaultProfile.name, email: data.profile_email?.[0] || '', photo: data.profile_photo?.[0] || '' };
}
function getInitialRoute(){
  try { const saved = localStorage.getItem(ACTIVE_ROUTE_KEY); return ROUTES.has(saved) ? saved : 'dashboard'; } catch(e) { return 'dashboard'; }
}

export default function App(){
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [route, setRoute] = useState(getInitialRoute);
  const [managers, setManagers] = useState([]);
  const [theme, setTheme] = useState('light');
  const [profile, setProfile] = useState(defaultProfile);
  const [modalRequest, setModalRequest] = useState(null);

  const navigate = (nextRoute) => {
    const safeRoute = ROUTES.has(nextRoute) ? nextRoute : 'dashboard';
    setRoute(safeRoute);
    try { localStorage.setItem(ACTIVE_ROUTE_KEY, safeRoute); } catch(e) {}
  };

  const loadProfile = () => api.get('/settings').then(r => setProfile(profileFromSettings(r.data))).catch(()=>{});

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setAuthChecking(false); return; }
    api.get('/auth/me').then(r => setUser(r.data.user)).catch(() => localStorage.removeItem(TOKEN_KEY)).finally(() => setAuthChecking(false));
  }, []);

  useEffect(()=>{
    if (!user) return;
    api.get('/invites').then(r=>setManagers(r.data)).catch(()=>{});
    loadProfile();
  },[user])

  useEffect(()=>{
    const onProfileUpdated = (e) => setProfile(e.detail || defaultProfile);
    const onAuthExpired = () => setUser(null);
    window.addEventListener('profileUpdated', onProfileUpdated);
    window.addEventListener('authExpired', onAuthExpired);
    return ()=>{ window.removeEventListener('profileUpdated', onProfileUpdated); window.removeEventListener('authExpired', onAuthExpired); };
  },[])

  useEffect(()=>{
    const requestPost = () => { navigate('list'); setModalRequest('post'); };
    const requestBulk = () => { navigate('list'); setModalRequest('bulk'); };
    window.addEventListener('requestNewPost', requestPost); window.addEventListener('requestBulkCreate', requestBulk);
    return ()=>{ window.removeEventListener('requestNewPost', requestPost); window.removeEventListener('requestBulkCreate', requestBulk); };
  },[])

  useEffect(()=>{
    if(route !== 'list' || !modalRequest) return;
    const request = modalRequest;
    const timer = window.setTimeout(()=>{ window.dispatchEvent(new CustomEvent(request === 'post' ? 'openPostModal' : 'openBulkModal')); setModalRequest(null); }, 0);
    return ()=>window.clearTimeout(timer);
  },[route, modalRequest])

  useEffect(()=>{
    const onNavigateToList = ()=>navigate('list');
    window.addEventListener('navigateToList', onNavigateToList);
    return ()=>window.removeEventListener('navigateToList', onNavigateToList);
  },[])

  useEffect(()=>{
    if (!user) return;
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
  }, [user])

  useEffect(()=>{ document.documentElement.setAttribute('data-theme', theme); },[theme])

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch (_) {}
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  };

  if (authChecking) return <div className="auth-loading">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="app-root layout-root">
      <Sidebar route={route} setRoute={navigate} theme={theme} setTheme={setTheme} />
      <div className="main-area">
        <Topbar title={route==='dashboard'? 'Dashboard' : route==='list'? 'All Posts' : route==='settings'? 'Settings' : 'Calendar'} managers={managers} profile={profile} />
        <button className="logout-button" onClick={logout} type="button">Sign out</button>
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
