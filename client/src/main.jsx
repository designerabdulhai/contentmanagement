import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import BulkCreate from './components/BulkCreate'
import './styles.css'
import './content.css'
import './content-mobile.css'
import './post-form-fix.css'
import './mobile-responsive.css'
import './mobile-list-card.css'
import './mobile-shell-calendar-fix.css'
import './list-time-status.css'
import './channel-row-colors.css'

createRoot(document.getElementById('root')).render(
  React.createElement(App)
)

let bulkRoot = null;
window.addEventListener('openBulkModal', ()=>{
  const modal = document.getElementById('bulkModal');
  if(!modal) return;
  modal.classList.remove('hidden');
  if(bulkRoot) return;
  bulkRoot = createRoot(modal);
  bulkRoot.render(React.createElement(BulkCreate, { onClose: ()=>{ modal.classList.add('hidden'); bulkRoot && bulkRoot.unmount(); bulkRoot = null; }, onDone: ()=>{ modal.classList.add('hidden'); bulkRoot && bulkRoot.unmount(); bulkRoot = null; } }))
});
