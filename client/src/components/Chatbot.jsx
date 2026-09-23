import React, { useEffect, useRef, useState } from 'react'
import api from '../api'

const starterQuestions=[
  '1. BHD তে কয়টা ভিডিও রেকর্ড করা আছে?',
  '2. HHD তে কয়টা ভিডিও রেকর্ড করা আছে?',
  '3. কয়টি ভিডিও শিডিউল করা আছে? কবে এবং কখন?',
  '4. এডিটিং করা আছে মোট কয়টি ভিডিও?',
]

const VIDEO_FIELDS=['full_video_status','short_ex_status','short_top_status','style_ex_status','style_top_status']
const norm=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[।?？!！,，:：;；|]/g,' ').replace(/\s+/g,' ').trim()
const channelOf=x=>String(x?.channel||'').trim().toUpperCase()
const nameOf=x=>String(x?.name||x?.project_name||x?.project||x?.title||'Untitled')
const statuses=x=>VIDEO_FIELDS.map(k=>String(x?.[k]??'').trim().toLowerCase())
const isRecorder=x=>statuses(x).every(v=>v==='record')
const isListed=x=>statuses(x).every(v=>v===''||v==='not set')
const isRunning=x=>!isListed(x)&&!isRecorder(x)&&statuses(x).some(Boolean)
const isEditingDone=x=>statuses(x).some(v=>v==='editing done'||v==='edited'||v==='edit done'||v.includes('editing done'))
const countQuestion=q=>/how\s*many|how\s*much|count|total|number|কত|কয়|কয়|কয়টি|কয়টি|কয়টা|কয়টা|সংখ্যা|মোট/.test(norm(q))
const listQuestion=q=>/show|list|which|what|give|name|names|বল|নাম|দেখাও|লিস্ট|তালিকা|কী\s*কী|কি\s*কি|কোন\s*কোন|কোনগুলো|কোন গুলো/.test(norm(q))
const getChannel=q=>{const m=norm(q).match(/(?:^|[^a-z])(hhd|bhd|dhd)(?:$|[^a-z])/i);return m?m[1].toUpperCase():null}
const getStage=q=>{const l=norm(q);if(/record|recorded|recorder|রেকর্ড|রেকর্ডেড|রেকর্ডার|রেকর্ড করা/.test(l))return'recorder';if(/editing|edited|edit done|এডিট|এডিটিং|এডিট করা/.test(l))return'editing';if(/running|in\s*progress|working|রানিং|চলছে/.test(l))return'running';if(/listed|not\s*set|ready|লিস্টেড|তালিকাভুক্ত/.test(l))return'listed';return null}
const followup=q=>/^(নাম|নামগুলো|নাম বল|নাম বলো|কি কি|কী কী|কোনগুলো|কোন গুলো|কোন কোন|which|what|which ones|list|list them|show|show me|details|বিস্তারিত|আর কি|আর কী|আরও|এগুলো|ওগুলো)(\s*(বল|দাও|দেখাও))?$/.test(norm(q))

function localVideoAnswer(question,history,contents){
  const q=norm(question), previous=[...(history||[])].filter(x=>x?.role==='user').map(x=>String(x.text||'')).reverse().find(x=>!followup(x))||''
  const source=followup(question)?previous:question
  const channel=getChannel(q)||getChannel(source)
  const stage=getStage(q)||getStage(source)
  if(!stage&&!channel&&!/video|ভিডিও|content|কনটেন্ট/.test(q)&&!followup(question))return null
  let rows=Array.isArray(contents)?contents.filter(Boolean):[]
  if(channel)rows=rows.filter(x=>channelOf(x)===channel)
  if(stage==='recorder')rows=rows.filter(isRecorder)
  else if(stage==='listed')rows=rows.filter(isListed)
  else if(stage==='running')rows=rows.filter(isRunning)
  else if(stage==='editing')rows=rows.filter(isEditingDone)
  if(countQuestion(q)&&!listQuestion(q))return `${channel?channel+' ':''}${stage==='recorder'?'Recorder':stage==='listed'?'Listed':stage==='running'?'Running':stage==='editing'?'Editing Done':'Total'} Videos: ${rows.length}`
  if(listQuestion(q)||followup(question))return `${channel?channel+' ':''}${stage==='recorder'?'Recorder':stage==='listed'?'Listed':stage==='running'?'Running':stage==='editing'?'Editing Done':'Content'} Videos: ${rows.length}\n\n${rows.length?rows.map((x,i)=>`${i+1}. ${nameOf(x)}`).join('\n'):'No matching videos found.'}`
  return null
}

export default function Chatbot(){
  const [open,setOpen]=useState(false)
  const [message,setMessage]=useState('')
  const [messages,setMessages]=useState([{role:'assistant',text:'Hi! আমি আপনার Content App-এর live data assistant। Content, video, recording, editing, schedule, post, channel, status, date, time, name—সব data নিয়ে প্রশ্ন করতে পারবেন।'}])
  const [loading,setLoading]=useState(false)
  const endRef=useRef(null)

  useEffect(()=>{if(open)endRef.current?.scrollIntoView({behavior:'smooth'})},[messages,loading,open])

  const ask=async(value)=>{
    const question=String(value||'').trim()
    if(!question||loading)return
    const history=messages.slice(-12)
    setMessage('')
    setMessages(cur=>[...cur,{role:'user',text:question}])
    setLoading(true)
    try{
      const response=await api.post('/chat',{message:question,history})
      let answer=response?.data?.answer||response?.data?.message||''

      // The live API may still be on an older deployment that returns
      // "not found". Use the same authenticated live Content endpoint as
      // the Content page and answer common video questions locally instead
      // of showing a false not-found message.
      if(!answer||/^(not found|no data found|data not found)$/i.test(String(answer).trim())){
        try{
          const contentResponse=await api.get('/contents')
          const localAnswer=localVideoAnswer(question,history,contentResponse?.data)
          if(localAnswer)answer=localAnswer
        }catch{}
      }

      setMessages(cur=>[...cur,{role:'assistant',text:String(answer||'এই প্রশ্নের জন্য কোনো উত্তর পাওয়া যায়নি।')}])
    }catch(error){
      let answer=error?.response?.data?.error||error?.message||'Unable to get answer.'
      try{
        const contentResponse=await api.get('/contents')
        const localAnswer=localVideoAnswer(question,history,contentResponse?.data)
        if(localAnswer)answer=localAnswer
      }catch{}
      setMessages(cur=>[...cur,{role:'assistant',text:String(answer)}])
    }finally{setLoading(false)}
  }

  const submit=e=>{e.preventDefault();ask(message)}

  if(!open)return <button onClick={()=>setOpen(true)} aria-label="Open App Assistant" title="Open App Assistant" style={{position:'fixed',right:24,bottom:24,width:56,height:56,border:0,borderRadius:'50%',background:'#6c5ce7',color:'#fff',cursor:'pointer',boxShadow:'0 10px 30px rgba(0,0,0,.18)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
    <svg width="29" height="29" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 8.7 3.9 8.38 8.38 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8v.5Z"/>
      <path d="M8 12h.01M12 12h.01M16 12h.01" strokeWidth="2.5"/>
    </svg>
  </button>

  return <div style={{position:'fixed',right:24,bottom:24,width:340,maxWidth:'calc(100vw - 32px)',height:520,maxHeight:'calc(100vh - 48px)',background:'#fff',borderRadius:18,boxShadow:'0 18px 60px rgba(0,0,0,.22)',overflow:'hidden',zIndex:1000,display:'flex',flexDirection:'column',border:'1px solid #e8e8ef'}}>
    <div style={{padding:'14px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:'1px solid #eee'}}>
      <div><div style={{fontWeight:800}}>App Assistant</div><div style={{fontSize:12,color:'#777'}}>Live app data</div></div>
      <button onClick={()=>setOpen(false)} style={{border:0,background:'transparent',fontSize:22,cursor:'pointer',color:'#777'}}>×</button>
    </div>
    <div style={{flex:1,overflowY:'auto',padding:14,background:'#fafafe'}}>
      {messages.map((m,i)=><div key={i} style={{display:'flex',justifyContent:m.role==='user'?'flex-end':'flex-start',marginBottom:10}}><div style={{maxWidth:'90%',whiteSpace:'pre-wrap',lineHeight:1.45,padding:'10px 12px',borderRadius:12,background:m.role==='user'?'#6c5ce7':'#fff',color:m.role==='user'?'#fff':'#20202a',border:m.role==='assistant'?'1px solid #eee':'none',fontSize:13}}>{m.text}</div></div>)}
      {messages.length===1&&!loading&&<div style={{marginTop:10}}>{starterQuestions.map((q,i)=><button key={i} onClick={()=>ask(q)} style={{display:'block',width:'100%',textAlign:'left',marginBottom:7,padding:'9px 10px',border:'1px solid #e5e2ff',borderRadius:10,background:'#fff',color:'#4f46b8',cursor:'pointer',fontSize:12}}>{q}</button>)}</div>}
      {loading&&<div style={{fontSize:12,color:'#777'}}>Thinking…</div>}
      <div ref={endRef}/>
    </div>
    <form onSubmit={submit} style={{display:'flex',gap:8,padding:10,borderTop:'1px solid #eee',background:'#fff'}}>
      <input value={message} onChange={e=>setMessage(e.target.value)} placeholder="Ask about videos, posts, or the app..." disabled={loading} style={{flex:1,minWidth:0,border:'1px solid #ddd',borderRadius:10,padding:'10px 11px',outline:'none'}}/>
      <button type="submit" disabled={loading||!message.trim()} style={{width:42,border:0,borderRadius:10,background:'#6c5ce7',color:'#fff',cursor:'pointer',fontSize:18}}>➤</button>
    </form>
  </div>
}
