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
  if (!/video|content|ভিডিও|কনটেন্ট/.test(lower)) return null

  const channelMatch = lower.match(/\b(hhd|bhd|dhd)\b/i)
  const channel = channelMatch ? channelMatch[1].toUpperCase() : null
  let stage = null
  if (/\blisted\b|not\s*set|ready|লিস্টেড|তালিকাভুক্ত/.test(lower)) stage = 'Listed'
  else if (/\brecorder\b|\brecorded\b|\brecord\b|রেকর্ড/.test(lower)) stage = 'Recorder'
  else if (/\brunning\b|in\s*progress|working|রানিং|চলছে/.test(lower)) stage = 'Running'

  const rows = contents.filter(item => !channel || channelOf(item) === channel)
  const matching = stage ? rows.filter(item => stageOf(item) === stage) : rows
  const asksCount = /\bhow many\b|\bcount\b|\btotal\b|কত|সংখ্যা|মোট/.test(lower)
  const asksList = /\bshow\b|\blist\b|\bwhich\b|\bwhat\b|কি|কী|দেখাও|লিস্ট/.test(lower)

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

function dhakaDateKey(value){
  if(!value) return null
  const raw=String(value).trim()
  if(!raw) return null

  // Values without an explicit timezone are stored as Bangladesh local time.
  if(!/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)){
    const match=raw.replace('T',' ').match(/^(\d{4}-\d{2}-\d{2})\s/)
    return match?.[1] || null
  }

  const d=new Date(raw)
  if(Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)
}

function dhakaTime(value){
  if(!value) return ''
  const raw=String(value).trim()
  let d

  if(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) d=new Date(raw)
  else d=new Date(raw.replace(' ','T')+'+06:00')

  if(Number.isNaN(d.getTime())) return raw
  return new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Dhaka',hour:'numeric',minute:'2-digit'}).format(d)
}

function todayDhakaKey(offsetDays=0){
  const now=new Date(Date.now()+offsetDays*86400000)
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
}

function localScheduleAnswer(question, posts){
  const lower=String(question||'').toLowerCase()
  const asksSchedule=/schedule|scheduled|calendar|post|today|tomorrow|শিডিউল|শিডিউলড|ক্যালেন্ডার|পোস্ট|আজ|আজকে|আগামীকাল/.test(lower)
  if(!asksSchedule) return null

  const channelMatch=lower.match(/\b(hhd|bhd|dhd)\b/i)
  const channel=channelMatch?channelMatch[1].toUpperCase():null
  const scheduled=posts.filter(p=>String(p?.status||'').trim().toLowerCase()==='scheduled' && p?.scheduled_at && (!channel || channelOf(p)===channel))
  const today=/\btoday\b|আজ|আজকে/.test(lower)
  const tomorrow=/\btomorrow\b|আগামীকাল/.test(lower)
  const asksCount=/\bhow many\b|\bcount\b|\btotal\b|কত|সংখ্যা|মোট/.test(lower)

  if(today || tomorrow){
    const key=todayDhakaKey(tomorrow?1:0)
    const matching=scheduled.filter(p=>dhakaDateKey(p.scheduled_at)===key)
    const title=`${channel?channel+' ':''}${tomorrow?'Tomorrow':'Today'} Scheduled Posts`
    if(!matching.length) return `${title}: 0\n\nNo scheduled posts found.`
    return `${title}: ${matching.length}\n\n${matching.map((p,index)=>`${index+1}. ${p.project_name||'Untitled'}${p.channel?` [${p.channel}]`:''} — ${dhakaTime(p.scheduled_at)}${p.content_type?` — ${p.content_type}`:''}`).join('\n')}`
  }

  if(asksCount) return `${channel?channel+' ':''}Total Scheduled Posts: ${scheduled.length}`

  if(/show|list|which|what|কি|কী|দেখাও|লিস্ট/.test(lower)){
    if(!scheduled.length) return `${channel?channel+' ':''}Scheduled Posts: 0\n\nNo scheduled posts found.`
    return `${channel?channel+' ':''}Scheduled Posts: ${scheduled.length}\n\n${scheduled.map((p,index)=>`${index+1}. ${p.project_name||'Untitled'}${p.channel?` [${p.channel}]`:''} — ${dhakaDateKey(p.scheduled_at)} ${dhakaTime(p.scheduled_at)}${p.content_type?` — ${p.content_type}`:''}`).join('\n')}`
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
      // Read live data from the same API used by the app. This avoids relying on
      // an AI/Worker deployment for exact counts, video lists, and schedules.
      const lower=question.toLowerCase()
      const wantsVideoData=/video|content|listed|record|recorder|running|ভিডিও|কনটেন্ট|লিস্টেড|রেকর্ড|রানিং/.test(lower)
      const wantsScheduleData=/schedule|scheduled|calendar|post|today|tomorrow|শিডিউল|ক্যালেন্ডার|পোস্ট|আজ|আজকে|আগামীকাল/.test(lower)

      if(wantsVideoData || wantsScheduleData){
        const requests=[]
        if(wantsVideoData) requests.push(api.get('/contents'))
        if(wantsScheduleData) requests.push(api.get('/posts'))
        const results=await Promise.all(requests)
        let resultIndex=0

        let contents=[]
        if(wantsVideoData){
          const contentResponse=results[resultIndex++]
          contents=Array.isArray(contentResponse.data)?contentResponse.data:[]
          const localAnswer=localVideoAnswer(question,contents)
          if(localAnswer){
            setMessages(current=>[...current,{role:'assistant',text:localAnswer}])
            return
          }
        }

        if(wantsScheduleData){
          const postsResponse=results[resultIndex++]
          const posts=Array.isArray(postsResponse.data)?postsResponse.data:[]
          const localAnswer=localScheduleAnswer(question,posts)
          if(localAnswer){
            setMessages(current=>[...current,{role:'assistant',text:localAnswer}])
            return
          }
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
