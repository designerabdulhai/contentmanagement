import React, { useEffect, useRef, useState } from 'react'
import api from '../api'

const VIDEO_FIELDS = ['full_video_status','short_ex_status','short_top_status','style_ex_status','style_top_status']

const starterQuestions = [
  '1. BHD তে কয়টা ভিডিও রেকর্ড করা আছে?',
  '2. HHD তে কয়টা ভিডিও রেকর্ড করা আছে?',
  '3. কয়টি ভিডিও শিডিউল করা আছে? কবে এবং কখন?',
  '4. এডিটিং করা আছে মোট কয়টি ভিডিও?',
]

function normalizeText(value){
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[।?？!！]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function channelOf(item){
  return String(item?.channel || '').trim().toUpperCase()
}

function stageOf(item){
  const statuses = VIDEO_FIELDS.map(key => String(item?.[key] || '').trim().toLowerCase())
  if (statuses.every(status => status === '')) return 'Listed'
  if (statuses.every(status => status === 'record')) return 'Recorder'
  return 'Running'
}

function isCountQuestion(text){
  return /how\s*many|count|total|number|কত|কয়|কয়|কয়টি|কয়টি|কয়টা|কয়টা|সংখ্যা|মোট/.test(text)
}

function wantsList(text){
  return /show|list|which|what|give|name|names|দেখাও|লিস্ট|তালিকা|কি\s*কি|কী\s*কী|কোন\s*কোন|নাম/.test(text)
}

function isNameFollowup(text){
  const value = normalizeText(text)
    .replace(/^(please|pls|দয়া করে|দয়া করে)\s+/, '')
    .trim()
  return /^(?:name|names|name please|show name|show names|নাম|নামগুলো|নাম গুলো|নাম বল|নামগুলো বল|নাম কি|নাম কী)$/.test(value)
}

function isVagueListQuestion(text){
  const value = normalizeText(text)
    .replace(/^(please|pls|দয়া করে|দয়া করে)\s+/, '')
    .trim()
  return /^(?:কি\s*কি|কী\s*কী|কোন\s*কোন|কি কি ভিডিও|কী কী ভিডিও|কোন কোন ভিডিও|what|which|what videos|which videos|show me|show list|list them|give me the list)$/.test(value)
}

function getChannel(text){
  const match = normalizeText(text).match(/(?:^|[^a-z])(hhd|bhd|dhd)(?:$|[^a-z])/i)
  return match ? match[1].toUpperCase() : null
}

function unwrapArray(response){
  const data = response?.data
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.data)) return data.data
  if (Array.isArray(data?.items)) return data.items
  if (Array.isArray(data?.posts)) return data.posts
  if (Array.isArray(data?.contents)) return data.contents
  return []
}

function formatContentNames(items){
  return items.map((item,index) => `${index + 1}. ${item?.name || item?.project_name || item?.project || 'Untitled'}`).join('\n')
}

function localVideoAnswer(question, contents){
  const lower = normalizeText(question)
  if (!/video|content|ভিডিও|কনটেন্ট/.test(lower)) return null

  const channel = getChannel(lower)
  let stage = null
  if (/\blisted\b|not\s*set|ready|লিস্টেড|তালিকাভুক্ত/.test(lower)) stage = 'Listed'
  else if (/\brecorded\b|\brecord\b|\brecorder\b|রেকর্ডেড|রেকর্ড|রেকর্ডার/.test(lower)) stage = 'Recorder'
  else if (/\brunning\b|in\s*progress|working|রানিং|চলছে/.test(lower)) stage = 'Running'

  const rows = contents.filter(item => !channel || channelOf(item) === channel)
  const matching = stage ? rows.filter(item => stageOf(item) === stage) : rows
  const count = isCountQuestion(lower)
  const list = wantsList(lower)

  if (stage && (count || list)) {
    const title = `${channel ? channel + ' ' : ''}${stage} Video`
    if (!matching.length) return `${title}: 0\n\nNo matching videos found.`

    const parts = []
    if (count) parts.push(`${title}: ${matching.length}`)
    if (list) parts.push(formatContentNames(matching))
    return parts.join('\n\n')
  }

  if (channel && (count || list)) {
    if (!rows.length) return `${channel}: 0\n\nNo content found.`
    const parts = []
    if (count) parts.push(`${channel} Total Content: ${rows.length}`)
    if (list) parts.push(rows.map((item,index) => `${index + 1}. ${item?.name || 'Untitled'} — ${stageOf(item)}`).join('\n'))
    return parts.join('\n\n')
  }

  return null
}

function localEditingAnswer(question, contents){
  const lower = normalizeText(question)
  if (!/edit|editing|এডিট|এডিটিং/.test(lower)) return null
  if (!/video|ভিডিও|কত|কয়|কয়|কয়টি|কয়টি|কয়টা|কয়টা|সংখ্যা|মোট|how\s*many|count|total/.test(lower)) return null

  const channel = getChannel(lower)
  const rows = contents.filter(item => !channel || channelOf(item) === channel)
  const editingCount = rows.reduce((total,item) => total + VIDEO_FIELDS.filter(key => String(item?.[key] || '').trim().toLowerCase() === 'editing done').length, 0)
  return `${channel ? channel + ' ' : ''}Total Editing Done Video: ${editingCount}`
}

function localEditingList(question, contents){
  const lower = normalizeText(question)
  if (!/edit|editing|এডিট|এডিটিং/.test(lower)) return null
  if (!wantsList(lower)) return null

  const channel = getChannel(lower)
  const rows = contents.filter(item => !channel || channelOf(item) === channel)
  const matching = rows.filter(item => VIDEO_FIELDS.some(key => String(item?.[key] || '').trim().toLowerCase() === 'editing done'))
  const title = `${channel ? channel + ' ' : ''}Editing Done Videos`
  if (!matching.length) return `${title}: 0\n\nNo editing-done videos found.`
  return `${title}: ${matching.length}\n\n${formatContentNames(matching)}`
}

function inferFollowup(question, previousQuestion){
  const current = normalizeText(question)
  const previous = normalizeText(previousQuestion)
  if (!previous) return null

  const vague = isVagueListQuestion(current)
  const nameFollowup = isNameFollowup(current)
  if (!vague && !nameFollowup) return null

  if (/edit|editing|এডিট|এডিটিং/.test(previous)) return 'editing'
  if (/\brecorded\b|\brecord\b|\brecorder\b|রেকর্ডেড|রেকর্ড|রেকর্ডার/.test(previous)) return 'recorded'
  if (/\brunning\b|in\s*progress|working|রানিং|চলছে/.test(previous)) return 'running'
  if (/\blisted\b|not\s*set|ready|লিস্টেড|তালিকাভুক্ত/.test(previous)) return 'listed'
  if (/schedule|scheduled|calendar|শিডিউল|ক্যালেন্ডার/.test(previous)) return 'scheduled'
  return null
}

function dhakaDateKey(value){
  if(!value) return null
  const raw = String(value).trim()
  if(!raw) return null
  if(!/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)){
    const match = raw.replace('T',' ').match(/^(\d{4}-\d{2}-\d{2})\s/)
    return match?.[1] || null
  }
  const d = new Date(raw)
  if(Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)
}

function dhakaTime(value){
  if(!value) return ''
  const raw = String(value).trim()
  let d
  if(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) d = new Date(raw)
  else d = new Date(raw.replace(' ','T') + '+06:00')
  if(Number.isNaN(d.getTime())) return raw
  return new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Dhaka',hour:'numeric',minute:'2-digit'}).format(d)
}

function todayDhakaKey(offsetDays=0){
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now)
  const year = Number(parts.find(p=>p.type==='year')?.value)
  const month = Number(parts.find(p=>p.type==='month')?.value)
  const day = Number(parts.find(p=>p.type==='day')?.value)
  const d = new Date(Date.UTC(year,month - 1,day + offsetDays))
  return d.toISOString().slice(0,10)
}

function localScheduleAnswer(question, posts){
  const lower = normalizeText(question)
  const asksSchedule = /schedule|scheduled|calendar|post|today|tomorrow|শিডিউল|শিডিউলড|ক্যালেন্ডার|পোস্ট|আজ|আজকে|আজকের|আগামীকাল/.test(lower)
  if(!asksSchedule) return null

  const channel = getChannel(lower)
  const scheduled = posts.filter(p => {
    const status = String(p?.status || '').trim().toLowerCase()
    return (status === 'scheduled' || status.includes('schedul')) && p?.scheduled_at && (!channel || channelOf(p) === channel)
  })

  const today = /\btoday\b|আজ|আজকে|আজকের/.test(lower)
  const tomorrow = /\btomorrow\b|আগামীকাল/.test(lower)
  const asksCount = isCountQuestion(lower)
  const asksWhen = /when|date|time|কবে|কখন|তারিখ|সময়|সময়/.test(lower)

  const formatPosts = (items,includeDate=true) => items.map((p,index) => {
    const project = p.project_name || p.name || p.project || 'Untitled'
    const ch = p.channel ? ` [${p.channel}]` : ''
    const date = includeDate ? `${dhakaDateKey(p.scheduled_at)} ` : ''
    const type = p.content_type ? ` — ${p.content_type}` : ''
    return `${index + 1}. ${project}${ch} — ${date}${dhakaTime(p.scheduled_at)}${type}`
  }).join('\n')

  if(today || tomorrow){
    const key = todayDhakaKey(tomorrow ? 1 : 0)
    const matching = scheduled.filter(p => dhakaDateKey(p.scheduled_at) === key)
    const title = `${channel ? channel + ' ' : ''}${tomorrow ? 'Tomorrow' : 'Today'} Scheduled Posts`
    if(!matching.length) return `${title}: 0\n\nNo scheduled posts found.`
    return `${title}: ${matching.length}\n\n${formatPosts(matching,false)}`
  }

  if(asksCount && asksWhen){
    if(!scheduled.length) return `${channel ? channel + ' ' : ''}Total Scheduled Posts: 0\n\nNo scheduled posts found.`
    return `${channel ? channel + ' ' : ''}Total Scheduled Posts: ${scheduled.length}\n\n${formatPosts(scheduled,true)}`
  }

  if(asksCount) return `${channel ? channel + ' ' : ''}Total Scheduled Posts: ${scheduled.length}`

  if(wantsList(lower)){
    if(!scheduled.length) return `${channel ? channel + ' ' : ''}Scheduled Posts: 0\n\nNo scheduled posts found.`
    return `${channel ? channel + ' ' : ''}Scheduled Posts: ${scheduled.length}\n\n${formatPosts(scheduled,true)}`
  }

  return null
}

export default function Chatbot(){
  const [open,setOpen] = useState(false)
  const [message,setMessage] = useState('')
  const [messages,setMessages] = useState([{role:'assistant',text:'Hi! I can help you find videos, counts, posts, and explain how this app works.'}])
  const [loading,setLoading] = useState(false)
  const endRef = useRef(null)

  useEffect(()=>{ if(open) endRef.current?.scrollIntoView({behavior:'smooth'}) },[messages,loading,open])

  const ask = async(text) => {
    const question = String(text || '').trim()
    if(!question || loading) return

    const previousUserQuestion = [...messages].reverse().find(item => item.role === 'user')?.text || ''
    const followupType = inferFollowup(question,previousUserQuestion)
    const vagueList = isVagueListQuestion(question)
    const nameFollowup = isNameFollowup(question)

    setMessage('')
    setMessages(current=>[...current,{role:'user',text:question}])
    setLoading(true)

    try{
      const lower = normalizeText(question)
      const wantsVideoData = /video|content|listed|record|recorder|running|edit|editing|ভিডিও|কনটেন্ট|লিস্টেড|রেকর্ড|রানিং|এডিট|এডিটিং/.test(lower) || Boolean(followupType) || vagueList || nameFollowup
      const wantsScheduleData = /schedule|scheduled|calendar|post|today|tomorrow|শিডিউল|ক্যালেন্ডার|পোস্ট|আজ|আজকে|আজকের|আগামীকাল/.test(lower) || followupType === 'scheduled'

      if(wantsVideoData || wantsScheduleData){
        const requests = []
        if(wantsVideoData) requests.push(api.get('/contents'))
        if(wantsScheduleData) requests.push(api.get('/posts'))
        const results = await Promise.all(requests)
        let resultIndex = 0

        if(wantsVideoData){
          const contents = unwrapArray(results[resultIndex++])
          let localAnswer = null

          if(followupType === 'editing'){
            localAnswer = localEditingList(previousUserQuestion,contents) || localEditingAnswer(previousUserQuestion,contents)
          } else if(followupType === 'recorded'){
            localAnswer = localVideoAnswer(`${previousUserQuestion} show names`,contents)
          } else if(followupType === 'running'){
            localAnswer = localVideoAnswer(`${previousUserQuestion} show names`,contents)
          } else if(followupType === 'listed'){
            localAnswer = localVideoAnswer(`${previousUserQuestion} show names`,contents)
          } else if(!followupType && !vagueList && !nameFollowup){
            localAnswer = localEditingAnswer(question,contents) || localEditingList(question,contents) || localVideoAnswer(question,contents)
          }

          if(localAnswer){
            setMessages(current=>[...current,{role:'assistant',text:localAnswer}])
            return
          }
        }

        if(wantsScheduleData){
          const posts = unwrapArray(results[resultIndex++])
          let localAnswer = localScheduleAnswer(question,posts)
          if(followupType === 'scheduled') localAnswer = localScheduleAnswer(`${previousUserQuestion} show list`,posts) || localAnswer
          if(localAnswer){
            setMessages(current=>[...current,{role:'assistant',text:localAnswer}])
            return
          }
        }
      }

      const r = await api.post('/chat',{message:question})
      const answer = r.data?.answer || r.data?.message || r.data?.data?.answer
      setMessages(current=>[...current,{role:'assistant',text:answer || 'I could not generate an answer.'}])
    }catch(e){
      setMessages(current=>[...current,{role:'assistant',text:e.message || 'Sorry, I could not reach the AI assistant.'}])
    }finally{
      setLoading(false)
    }
  }

  const submit = e => { e.preventDefault(); ask(message) }

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