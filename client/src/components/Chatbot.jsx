import React, { useEffect, useRef, useState } from 'react'
import api from '../api'

const starterQuestions=[
  '1. BHD তে কয়টা ভিডিও রেকর্ড করা আছে?',
  '2. HHD তে কয়টা ভিডিও রেকর্ড করা আছে?',
  '3. কয়টি ভিডিও শিডিউল করা আছে? কবে এবং কখন?',
  '4. এডিটিং করা আছে মোট কয়টি ভিডিও?',
]

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
      const answer=response?.data?.answer||response?.data?.message
      setMessages(cur=>[...cur,{role:'assistant',text:String(answer||'এই প্রশ্নের জন্য কোনো উত্তর পাওয়া যায়নি।')}])
    }catch(error){
      const answer=error?.response?.data?.error||error?.message||'Unable to get answer.'
      setMessages(cur=>[...cur,{role:'assistant',text:String(answer)}])
    }finally{setLoading(false)}
  }

  const submit=e=>{e.preventDefault();ask(message)}

  if(!open)return <button onClick={()=>setOpen(true)} aria-label="Open App Assistant" style={{position:'fixed',right:24,bottom:24,width:52,height:52,border:0,borderRadius:'50%',background:'#6c5ce7',color:'#fff',fontWeight:800,cursor:'pointer',boxShadow:'0 10px 30px rgba(0,0,0,.18)',zIndex:1000}}>AI</button>

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
