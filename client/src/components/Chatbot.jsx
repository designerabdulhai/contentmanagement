import React, { useEffect, useRef, useState } from 'react'
import api from '../api'

const starterQuestions = [
  'Show me all HHD listed videos',
  'How many recorder videos do HHD and BHD have?',
  'Show me the running videos for BHD',
]

export default function Chatbot(){
  const [open,setOpen]=useState(false)
  const [message,setMessage]=useState('')
  const [messages,setMessages]=useState([{role:'assistant',text:'Hi! I can help you find videos, counts, posts, and explain how this app works.'}])
  const [loading,setLoading]=useState(false)
  const endRef=useRef(null)

  useEffect(()=>{ if(open) endRef.current?.scrollIntoView({behavior:'smooth'}) },[messages,loading,open])

  const ask=async(text)=>{
    const question=String(text||'').trim()
    if(!question||loading)return
    setMessage('')
    setMessages(current=>[...current,{role:'user',text:question}])
    setLoading(true)
    try{
      const r=await api.post('/chat',{message:question})
      setMessages(current=>[...current,{role:'assistant',text:r.data?.answer||'I could not generate an answer.'}])
    }catch(e){
      setMessages(current=>[...current,{role:'assistant',text:e.message||'Sorry, I could not reach the AI assistant.'}])
    }finally{setLoading(false)}
  }

  const submit=e=>{e.preventDefault();ask(message)}

  return <>
    {open&&<div className="chatbot-panel" role="dialog" aria-label="App assistant">
      <div className="chatbot-head">
        <div className="chatbot-brand"><span className="chatbot-logo">AI</span><div><strong>App Assistant</strong><small>Live app data</small></div></div>
        <button type="button" className="chatbot-close" onClick={()=>setOpen(false)} aria-label="Close chatbot">×</button>
      </div>
      <div className="chatbot-messages">
        {messages.map((item,index)=><div key={index} className={`chatbot-message ${item.role}`}>{item.text}</div>)}
        {messages.length===1&&!loading&&<div className="chatbot-starters">{starterQuestions.map(q=><button key={q} type="button" onClick={()=>ask(q)}>{q}</button>)}</div>}
        {loading&&<div className="chatbot-message assistant chatbot-typing">Thinking…</div>}
        <div ref={endRef}/>
      </div>
      <form className="chatbot-form" onSubmit={submit}>
        <input value={message} onChange={e=>setMessage(e.target.value)} placeholder="Ask about videos, posts, or the app…" disabled={loading}/>
        <button type="submit" disabled={loading||!message.trim()} aria-label="Send">➤</button>
      </form>
    </div>}
    <button type="button" className={`chatbot-fab ${open?'open':''}`} onClick={()=>setOpen(v=>!v)} aria-label={open?'Close assistant':'Open assistant'}>{open?'×':'💬'}</button>
  </>
}
