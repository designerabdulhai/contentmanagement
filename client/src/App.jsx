import React, {useState, useEffect} from 'react'
import Dashboard from './pages/Dashboard'
import ListView from './pages/ListView'
import Content from './pages/Content'
import Settings from './pages/Settings'
import CalendarView from './pages/CalendarView'
import Login from './pages/Login'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import PostForm from './components/PostForm'
import Chatbot from './components/Chatbot'
import './chatbot.css'
import api, { TOKEN_KEY } from './api'

const defaultProfile = { name: 'Owner Name', email: '', photo: '' };
const ROUTES = new Set(['dashboard','list','content','calendar','settings']);
const ACTIVE_ROUTE_KEY = 'content_schedule_active_route';

function profileFromSettings(data){
  return { name: data.profile_name?.[0] || defaultProfile.name, email: data.profile_email?.[0] || '', photo: data.profile_photo?.[0] || '' };
}
function getInitialRoute(){
  try { const saved = localStorage.getItem(ACTIVE_ROUTE_KEY); return ROUTES.has(saved) ? saved : 'dashboard'; } catch(e) { return 'dashboard'; }
}

// Decode only the non-sensitive token payload so the application shell can
// render immediately. The API still validates the token in the background.
function getOptimisticUser(token){
  try {
    const encoded = String(token || '').split('.')[0];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)));
    const id = Number(payload?.split?.('.')?.[0]);
    const exp = Number(payload?.split?.('.')?.[1]);
    if (!Number.isInteger(id) || !Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
    return { id };
  } catch {
    return null;
  }
}

export default function App(){
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [route, setRoute] = useState(getInitialRoute);
  const [managers, setManagers] = useState([]);
  const [theme, setTheme] = useState('light');
  const [profile, setProfile] = useState(defaultProfile);
  const [modalRequest, setModalRequest] = useState(null);
  const [editingPost, setEditingPost] = useState(null);

  const navigate = (nextRoute) => {
    const safeRoute = ROUTES.has(nextRoute) ? nextRoute : 'dashboard';
    setRoute(safeRoute);
    try { localStorage.setItem(ACTIVE_ROUTE_KEY, safeRoute); } catch(e) {}
  };

  const loadProfile = () => api.get('/settings').then(r => setProfile(profileFromSettings(r.data))).catch(()=>{});

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);

    if (!token) {
      setAuthChecking(false);
      return;
    }

    // Do not block the whole application on /auth/me. The old implementation
    // kept the entire page on "Loading…" until this request completed.
    const optimisticUser = getOptimisticUser(token);
    if (optimisticUser) {
      setUser(optimisticUser);
      setAuthChecking(false);
    }

    api.get('/auth/me')
      .then(r => setUser(r.data.user))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
      })
      .finally(() => setAuthChecking(false));
  }, []);

  useEffect(()=>{
    if (!user) return;
    // These requests can run together without delaying the first render.
    Promise.allSettled([
      api.get('/invites').then(r=>setManagers(r.data)),
      loadProfile(),
    ]);
  },[user])

  useEffect(()=>{
    const onProfileUpdated = (e) => setProfile(e.detail || defaultProfile);
    const onAuthExpired = () => setUser(null);
    const onEditPost = (e) => {
      if(!e.detail?.id) return;
      navigate('list');
      setEditingPost(e.detail);
    };
    window.addEventListener('profileUpdated', onProfileUpdated);
    window.addEventListener('authExpired', onAuthExpired);
    window.addEventListener('editPost', onEditPost);
    return ()=>{
      window.removeEventListener('profileUpdated', onProfileUpdated);
      window.removeEventListener('authExpired', onAuthExpired);
      window.removeEventListener('editPost', onEditPost);
    };
  },[])

  useEffect(()=>{
    if(!editingPost) return;
    const timer = window.setTimeout(()=>window.dispatchEvent(new CustomEvent('editPost',{detail:editingPost})), 0);
    return ()=>window.clearTimeout(timer);
  },[editingPost]);

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

  // Keyboard shortcut: N = New Post.
  // The '?' Help shortcut has been removed.
  useEffect(()=>{
    if (!user) return;
    const onKey = (e)=>{
      if(e.key.toLowerCase()==='n'){
        const active = document.activeElement;
        if(active && (active.tagName==='INPUT' || active.tagName==='TEXTAREA' || active.isContentEditable)) return;
        window.dispatchEvent(new CustomEvent('requestNewPost'));
      }
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

  if (authChecking && !user) return <div className="auth-loading">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="app-root layout-root">
      <Sidebar route={route} setRoute={navigate} theme={theme} setTheme={setTheme} />
      <div className="main-area">
        <Topbar title={route==='dashboard'? 'Dashboard' : route==='list'? 'All Posts' : route==='content' ? 'Content' : route==='settings'? 'Settings' : 'Calendar'} managers={managers} profile={profile} onLogout={logout} />
        <main className="main-content">
          {route==='dashboard' && <Dashboard />}
          {route==='list' && <ListView />}
          {route==='content' && <Content />}
          {route==='settings' && <Settings />}
          {route==='calendar' && <CalendarView />}
        </main>
      </div>
      {editingPost && (
        <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditingPost(null)}}>
          <div className="modal create-post-modal" role="dialog" aria-modal="true">
            <PostForm onSaved={()=>{setEditingPost(null); window.location.reload()}} onCancel={()=>setEditingPost(null)} />
          </div>
        </div>
      )}
      <Chatbot />
    </div>
  )
}
