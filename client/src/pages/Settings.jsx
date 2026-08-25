import React, {useEffect, useState} from 'react'
import api from '../api'

const DEFAULT_PROFILE = { name: 'Owner Name', email: '', photo: '' };

function readProfile(settings) {
  return {
    name: settings.profile_name?.[0] || DEFAULT_PROFILE.name,
    email: settings.profile_email?.[0] || '',
    photo: settings.profile_photo?.[0] || '',
  };
}

function imageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 320;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1]);
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Settings(){
  // Do not render default/empty settings before the API response arrives.
  // This prevents the visible flash of old/default values on every page load.
  const [settings, setSettings] = useState(null);
  const [profile, setProfile] = useState(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState('');
  const [newInvite, setNewInvite] = useState('');
  const [templates, setTemplates] = useState([]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [syncingSheets, setSyncingSheets] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  const load = async () => {
    setSettingsLoading(true);
    setSettingsError('');
    try {
      const r = await api.get('/settings');
      const data = r?.data || {};
      setSettings(data);
      setProfile(readProfile(data));
    } catch (error) {
      setSettingsError(error?.message || 'Could not load settings.');
    } finally {
      setSettingsLoading(false);
    }
  };

  useEffect(()=>{ load(); },[])
  useEffect(()=>{ api.get('/templates').then(r=>setTemplates(r.data)).catch(()=>{}); },[])

  const save = (key, values)=> api.put('/settings/'+key, values).then(()=>load());

  const saveProfile = async (e) => {
    e.preventDefault();
    if (!profile?.name?.trim()) return setProfileMessage('Please enter your name.');
    setSavingProfile(true);
    setProfileMessage('');
    try {
      await save('profile_name', [profile.name.trim()]);
      await save('profile_email', [profile.email.trim()]);
      await save('profile_photo', [profile.photo || '']);
      window.dispatchEvent(new CustomEvent('profileUpdated', { detail: profile }));
      setProfileMessage('Profile saved successfully.');
    } catch (error) {
      setProfileMessage(error.message || 'Could not save profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return setProfileMessage('Please select an image file.');
    if (file.size > 5 * 1024 * 1024) return setProfileMessage('Image must be smaller than 5 MB');
    try {
      const photo = await imageToBase64(file);
      setProfile(p => ({ ...p, photo }));
      setProfileMessage('Photo ready. Click Save Profile.');
    } catch {
      setProfileMessage('Could not read the selected image.');
    }
  };

  const invite = ()=>{
    if (!newInvite.trim()) return;
    api.post('/invite',{email:newInvite,role:'manager'}).then(()=>setNewInvite('')).catch(()=>{});
  }

  const syncGoogleSheets = async () => {
    setSyncingSheets(true);
    setSyncMessage('Syncing all D1 data to Google Sheets…');
    try {
      const response = await api.post('/google-sheets/sync');
      const data = response.data || {};
      if (!data.ok) throw new Error(data.error || 'Google Sheets sync failed.');
      const count = Array.isArray(data.tables) ? data.tables.length : 0;
      setSyncMessage(`Sync completed successfully. ${count} table(s) synced.`);
    } catch (error) {
      setSyncMessage(`Sync failed: ${error.message || 'Unknown error'}`);
    } finally {
      setSyncingSheets(false);
    }
  };

  if (settingsLoading || !settings || !profile) {
    return (
      <div className="page settings">
        <h2>Settings</h2>
        <div className="card settings-loading-state">
          <h3>Loading settings…</h3>
          <p className="setting-help">Loading your saved settings.</p>
        </div>
      </div>
    );
  }

  if (settingsError) {
    return (
      <div className="page settings">
        <h2>Settings</h2>
        <div className="card">
          <h3>Could not load settings</h3>
          <p className="setting-help">{settingsError}</p>
          <button className="btn-primary" type="button" onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  const photoSrc = profile.photo ? `data:image/jpeg;base64,${profile.photo}` : '';

  return (
    <div className="page settings">
      <h2>Settings</h2>

      <div className="card profile-settings">
        <div className="card-header">
          <div>
            <h3>Profile</h3>
            <p className="setting-help">Change your display name and profile picture.</p>
          </div>
        </div>
        <form className="profile-form" onSubmit={saveProfile}>
          <div className="profile-photo-area">
            <div className="profile-photo-preview">
              {photoSrc ? <img src={photoSrc} alt="Profile" /> : <span>{(profile.name || 'O').trim().charAt(0).toUpperCase()}</span>}
            </div>
            <div>
              <label className="btn-secondary photo-button">
                Change picture
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onPhoto} hidden />
              </label>
              <div className="setting-help">JPG, PNG or WebP · max 5 MB</div>
            </div>
          </div>

          <div className="profile-fields">
            <label>
              <span>Name</span>
              <input value={profile.name} maxLength={80} onChange={e=>setProfile(p=>({...p,name:e.target.value}))} placeholder="Your name" />
            </label>
            <label>
              <span>Email</span>
              <input type="email" value={profile.email} onChange={e=>setProfile(p=>({...p,email:e.target.value}))} placeholder="you@example.com" />
            </label>
          </div>
          <div className="profile-actions">
            {profileMessage && <span className="save-message">{profileMessage}</span>}
            <button className="btn-primary" type="submit" disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save Profile'}</button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3>Google Sheets Sync</h3>
            <p className="setting-help">Manually sync all current D1 data to the configured Google Sheet.</p>
          </div>
          <button className="btn-primary" onClick={syncGoogleSheets} disabled={syncingSheets}>
            {syncingSheets ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
        {syncMessage && <div className="setting-help" style={{marginTop: 10}}>{syncMessage}</div>}
      </div>

      <div className="setting-group">
        <label>Content Types (comma separated)</label>
        <input value={(settings.content_types||[]).join(', ')} onChange={e=>setSettings(s=>({...s,content_types:e.target.value.split(',').map(v=>v.trim())}))} onBlur={e=>save('content_types', e.target.value.split(',').map(s=>s.trim()))} />
      </div>
      <div className="setting-group">
        <label>Channels</label>
        <input value={(settings.channels||[]).join(', ')} onChange={e=>setSettings(s=>({...s,channels:e.target.value.split(',').map(v=>v.trim())}))} onBlur={e=>save('channels', e.target.value.split(',').map(s=>s.trim()))} />
      </div>
      <div className="setting-group">
        <label>Platforms</label>
        <input value={(settings.platforms||[]).join(', ')} onChange={e=>setSettings(s=>({...s,platforms:e.target.value.split(',').map(v=>v.trim())}))} onBlur={e=>save('platforms', e.target.value.split(',').map(s=>s.trim()))} />
      </div>
      <div className="invite">
        <h3>Invite Manager</h3>
        <input placeholder="Email" value={newInvite} onChange={e=>setNewInvite(e.target.value)} />
        <button onClick={invite}>Invite</button>
      </div>
      <div className="card">
        <h3>Templates</h3>
        <ul>
          {templates.map(t=> <li key={t.id}>{t.name} — {t.content_type} / {t.channel} <button onClick={()=>{ api.delete('/templates/'+t.id).then(()=> setTemplates(ts=>ts.filter(x=>x.id!==t.id))); }}>Delete</button></li>)}
        </ul>
      </div>
    </div>
  )
}
