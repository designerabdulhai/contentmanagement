import React, {useState} from 'react'

const ensureUrl = (url)=>{
  if(!url) return '';
  if(/^https?:\/\//i.test(url)) return url;
  return 'https://' + url;
}

export default function LinkActions({url}){
  const [copied, setCopied] = useState(false);
  const safe = ensureUrl(url);

  const open = (e)=>{
    e && e.preventDefault();
    if(!safe) return;
    window.open(safe, '_blank', 'noopener,noreferrer');
  }

  const copy = async ()=>{
    if(!safe) return;
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(safe);
      } else {
        window.prompt('Copy URL (Ctrl+C / Cmd+C, Enter):', safe);
      }
      setCopied(true);
      setTimeout(()=>setCopied(false), 1500);
    }catch(err){
      window.prompt('Copy URL (Ctrl+C / Cmd+C, Enter):', safe);
    }
  }

  return (
    <span className="link-actions">
      <button className="icon-btn link-open-btn" type="button" onClick={open} disabled={!url} title={url ? 'Open link in new tab' : 'No link'} aria-label={url ? 'Open link in new tab' : 'No link'}>
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h5V3H5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-5h-2v5H5V5z"/></svg>
      </button>
      <button className={`icon-btn link-copy-btn${copied ? ' copied' : ''}`} type="button" onClick={copy} disabled={!url} title={url ? (copied ? 'Copied' : 'Copy link') : 'No link'} aria-label={url ? (copied ? 'Copied' : 'Copy link') : 'No link'}>
        {copied ? (
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
        )}
      </button>
    </span>
  )
}
