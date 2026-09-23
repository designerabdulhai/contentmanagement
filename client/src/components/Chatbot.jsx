import React, { useEffect, useRef, useState } from 'react'
import api from '../api'

const VIDEO_FIELDS = ['full_video_status','short_ex_status','short_top_status','style_ex_status','style_top_status']
const starterQuestions = [
  'Show me all HHD listed videos',
  'How many recorder videos do HHD and BHD have?',
  'Show me the running videos for BHD',
]

function stageOf(item){
  const statuses = VIDEO_FIELDS.map(key => String(item?.[key] || '').trim())
  if (statuses.every(status => status === '')) return 'Listed'
  if (statuses.every(status => status.toLowerCase() === 'record')) return 'Recorder'
  return 'Running'
}

function channelOf(item){ return String(item?.channel || '').trim().toUpperCase() }

function localVideoAnswer(question, contents){
  const lower = String(question || '').toLowerCase()
  if (!/video|content/.test(lower)) return null

  const channelMatch = lower.match(/\b(hhd|bhd|dhd)\b/i)
  const channel = channelMatch ? channelMatch[1].toUpperCase() : null
  let stage = null
  if (/\blisted\b|not\s*set|ready/.test(lower)) stage = 'Listed'
  else if (/\brecorder\b|\brecorded\b|\brecord\b/.test(lower)) stage = 'Recorder'
  else if (/\brunning\b|in\s*progress|working/.test(lower)) stage = 'Running'

  const rows = contents.filter(item => !channel || channelOf(item) === channel)
  const matching = stage ? rows.filter(item => stageOf(item) === stage) : rows
  const asksCount = /\bhow many\b|\bcount\b|\btotal/.test(lower)
  const asksList = /\bshow\b|\blist\b|\bwhich\b|\bwhat\b/.test(lower)

  if (stage && asksCount) return `${channel ? channel + ' ' : ''}${stage} Video: ${matching.length}`

  if (stage && (asksList || !channel || channel)) {
    const title = `${channel ? channel + ' ' : ''}${stage} Video`
    if (!matching.length) return `${title}: 0\n\nNo matching videos found.`
    return `${title}: ${matching.length}\n\n${matching.map((item,index) => `${index + 1}. ${item.name}`).join('\n')}`
  }

  if (channel && asksCount) return `${channel} Total Content: ${rows.length}`
  if (channel && asksList) {
    if (!rows.length) return `${channel}: 0\n\nNo content found.`
    return `${channel} Content: ${rows.length}\n\n${rows.map((item,index) => `${index + 1}. ${item.name} — ${stageOf(item)}`).join('\n')}`
  }

  return null
}

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
      // Read the same live content endpoint used by the Content page first.
      // This makes video lists/counts exact even if the AI worker is temporarily stale.
      const wantsVideoData=/video|content|listed|record|recorder|running/.test(question.toLowerCase())
      if(wantsVideoData){
        const contentResponse=await api.get('/contents')
        const contents=Array.isArray(contentResponse.data)?contentResponse.data:[]
        const localAnswer=localVideoAnswer(question,contents)
        if(localAnswer){
          setMessages(current=>[...current,{role:'assistant',text:localAnswer}])
          return
        }
      }

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
