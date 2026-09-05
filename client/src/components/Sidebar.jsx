import React from 'react'

const NavItem = ({icon, label, active, onClick})=> (
  <div className={"nav-item" + (active? ' active':'')} onClick={onClick}>
    <div className="nav-icon">{icon}</div>
    <div className="nav-label">{label}</div>
  </div>
)

export default function Sidebar({route,setRoute,theme,setTheme}){
  return (
    <aside className="sidebar sidebar-fixed">
      <div className="brand">
        <div className="logo">CS</div>
        <div className="appname">Content Schedule</div>
      </div>

      <nav className="nav">
        <NavItem icon={<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M3 13h8V3H3v10zm0 8h8v-6H3v6zM13 21h8V11h-8v10zM13 3v6h8V3h-8z"/></svg>} label="Dashboard" active={route==='dashboard'} onClick={()=>setRoute('dashboard')} />
        <NavItem icon={<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zm1 2v10h14V7H5zm2 2h10v2H7V9zm0 4h7v2H7v-2z"/></svg>} label="Content" active={route==='content'} onClick={()=>setRoute('content')} />
        <NavItem icon={<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M3 6h18v2H3V6zm0 4h12v2H3v-2zm0 4h18v2H3v-2z"/></svg>} label="List" active={route==='list'} onClick={()=>setRoute('list')} />
        <NavItem icon={<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M7 3h10v2H7V3zm-2 4h14v14H5V7zm2 2v10h10V9H7zm2 2h6v2H9v-2zm0 4h6v2H9v-2z"/></svg>} label="Calendar" active={route==='calendar'} onClick={()=>setRoute('calendar')} />
        <NavItem icon={<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M12 8a4 4 0 110 8 4 4 0 010-8zm8 2v6H4v-6H2v6a2 2 0 002 2h16a2 2 0 002-2v-6h-2z"/></svg>} label="Settings" active={route==='settings'} onClick={()=>setRoute('settings')} />
      </nav>

      <div className="sidebar-footer">
        <div className="theme-toggle">
          <label className="switch">
            <input type="checkbox" checked={theme==='dark'} onChange={e=>setTheme(e.target.checked? 'dark':'light')} />
            <span className="slider" />
          </label>
          <div className="theme-label">{theme==='dark' ? 'Dark' : 'Light'}</div>
        </div>
      </div>
    </aside>
  )
}
