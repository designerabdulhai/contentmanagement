import React from 'react'

export default function Topbar({title, managers, profile}){
  const name = profile?.name || 'Owner Name';
  const photo = profile?.photo ? `data:image/jpeg;base64,${profile.photo}` : '';
  const initials = name.trim().charAt(0).toUpperCase() || 'O';

  return (
    <div className="topbar-inner">
      <div className="page-title">{title}</div>
      <div className="topbar-actions">
        <div className="notify">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M12 22a2 2 0 002-2H10a2 2 0 002 2zm6-6v-5a6 6 0 10-12 0v5l-2 2v1h16v-1l-2-2z"/></svg>
          <span className="dot" />
        </div>

        <div className="managers-stack">
          {managers.slice(0,4).map((m,i)=> (
            <div key={i} className="avatar" title={m.email}>{(m.email || '?')[0].toUpperCase()}</div>
          ))}
          {managers.length>4 && <div className="avatar more">+{managers.length-4}</div>}
        </div>

        <div className="profile" title={profile?.email || name}>
          <div className="profile-avatar">
            {photo ? <img src={photo} alt={name} /> : initials}
          </div>
          <div className="profile-name">{name} <span className="caret">▾</span></div>
        </div>
      </div>
    </div>
  )
}
