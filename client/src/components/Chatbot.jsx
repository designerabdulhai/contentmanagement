import React, { useEffect, useRef, useState } from 'react'
import api from '../api'

const starterQuestions = [
  'BHD তে কয়টা ভিডিও রেকর্ড করা আছে?',
  'HHD তে কয়টা ভিডিও রেকর্ড করা আছে?',
  'কয়টি ভিডিও শিডিউল করা আছে? কবে এবং কখন?',
  'আজকে কী কী ভিডিও আপলোড হয়েছে?',
  'HHD এর সব data দেখাও',
]

const textOf = (value) => String(value ?? '').trim()

export default function Chatbot() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: 'Hi! আমি আপনার Content App-এর live data assistant। Content App-এর সব available data পড়ে প্রশ্নের উত্তর দিতে পারি—Content, Post, Schedule, Client, Book, Channel, Status, Date, Time এবং অন্যান্য app data।',
    },
  ])
  const [loading, setLoading] = useState(false)
  const endRef = useRef(null)

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, open])

  const ask = async (value) => {
    const question = textOf(value)
    if (!question || loading) return

    const history = messages.slice(-30)
    setMessage('')
    setMessages((current) => [...current, { role: 'user', text: question }])
    setLoading(true)

    try {
      // Every question goes to the server assistant. The server loads the
      // complete live database before asking the model, so there is no
      // separate/limited browser-side question parser that can give wrong data.
      const response = await api.post('/chat', {
        message: question,
        history,
      })

      const answer = textOf(response?.data?.answer || response?.data?.message)
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: answer || 'এই প্রশ্নের জন্য live database থেকে কোনো উত্তর পাওয়া যায়নি।',
        },
      ])
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: `Live data assistant error: ${error?.message || 'Unknown error'}`,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const submit = (event) => {
    event.preventDefault()
    ask(message)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open App Assistant"
        title="Open App Assistant"
        style={{
          position: 'fixed', right: 24, bottom: 24, width: 58, height: 58,
          border: 0, borderRadius: '50%', background: '#6c5ce7', color: '#fff',
          cursor: 'pointer', boxShadow: '0 10px 30px rgba(0,0,0,.18)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800,
        }}
      >
        <span style={{ fontSize: 24, lineHeight: 1 }}>💬</span>
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'fixed', right: 24, bottom: 24, width: 360,
        maxWidth: 'calc(100vw - 32px)', height: 560, maxHeight: 'calc(100vh - 48px)',
        background: '#fff', borderRadius: 18, boxShadow: '0 18px 60px rgba(0,0,0,.22)',
        overflow: 'hidden', zIndex: 1000, display: 'flex', flexDirection: 'column',
        border: '1px solid #e8e8ef',
      }}
    >
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #eee' }}>
        <div>
          <div style={{ fontWeight: 800 }}>App Assistant</div>
          <div style={{ fontSize: 12, color: '#777' }}>Complete live app data • Context aware</div>
        </div>
        <button onClick={() => setOpen(false)} style={{ border: 0, background: 'transparent', fontSize: 22, cursor: 'pointer', color: '#777' }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14, background: '#fafafe' }}>
        {messages.map((item, index) => (
          <div key={index} style={{ display: 'flex', justifyContent: item.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
            <div style={{ maxWidth: '92%', whiteSpace: 'pre-wrap', lineHeight: 1.5, padding: '10px 12px', borderRadius: 12, background: item.role === 'user' ? '#6c5ce7' : '#fff', color: item.role === 'user' ? '#fff' : '#20202a', border: item.role === 'assistant' ? '1px solid #eee' : 'none', fontSize: 13 }}>
              {item.text}
            </div>
          </div>
        ))}

        {messages.length === 1 && !loading && (
          <div style={{ marginTop: 10 }}>
            {starterQuestions.map((item, index) => (
              <button key={index} onClick={() => ask(item)} style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 7, padding: '9px 10px', border: '1px solid #e5e2ff', borderRadius: 10, background: '#fff', color: '#4f46b8', cursor: 'pointer', fontSize: 12 }}>
                {item}
              </button>
            ))}
          </div>
        )}

        {loading && <div style={{ fontSize: 12, color: '#777' }}>Reading all live app data…</div>}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #eee', background: '#fff' }}>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ask anything about the Content App..."
          disabled={loading}
          style={{ flex: 1, minWidth: 0, border: '1px solid #ddd', borderRadius: 10, padding: '10px 11px', outline: 'none' }}
        />
        <button type="submit" disabled={loading || !message.trim()} style={{ width: 42, border: 0, borderRadius: 10, background: '#6c5ce7', color: '#fff', cursor: 'pointer', fontSize: 18 }}>
          ➤
        </button>
      </form>
    </div>
  )
}
