import React, { useEffect, useRef, useState } from 'react'
import api from '../api'

const starterQuestions = [
  'BHD তে কয়টা ভিডিও রেকর্ড করা আছে?',
  'HHD তে কয়টা ভিডিও রেকর্ড করা আছে?',
  'কয়টি ভিডিও শিডিউল করা আছে? কবে এবং কখন?',
  'এডিটিং করা আছে মোট কয়টি ভিডিও?',
]

const VIDEO_FIELDS = ['full_video_status', 'short_ex_status', 'short_top_status', 'style_ex_status', 'style_top_status']

const textOf = (v) => String(v ?? '').trim()
const normalize = (v) => textOf(v).normalize('NFKC').toLowerCase().replace(/[।?？!！,，:：;；|()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim()
const channelOf = (row) => textOf(row?.channel).toUpperCase()
const nameOf = (row) => textOf(row?.name || row?.project_name || row?.project || row?.title || 'Untitled')
const statusOf = (row) => textOf(row?.status).toLowerCase()
const statusesOf = (row) => VIDEO_FIELDS.map((k) => textOf(row?.[k]).toLowerCase())

const isListed = (row) => statusesOf(row).every((v) => !v || v === 'not set')
const isRecorder = (row) => statusesOf(row).every((v) => v === 'record')
const isEditingDone = (row) => statusesOf(row).some((v) => v === 'editing done' || v === 'edited' || v === 'edit done' || v.includes('editing done'))
const isRunning = (row) => !isListed(row) && !isRecorder(row) && statusesOf(row).some(Boolean)

const has = (q, re) => re.test(normalize(q))
const isCountQuestion = (q) => has(q, /how many|how much|count|total|number|কত|কয়|কয়|কয়টি|কয়টি|কয়টা|কয়টা|সংখ্যা|মোট/)
const isListQuestion = (q) => has(q, /show|list|which|what|give|name|names|বল|নাম|দেখাও|লিস্ট|তালিকা|কি কি|কী কী|কোন কোন|কোনগুলো|কোন গুলো|কারা|কোনটা|কোনটি/)
const isFollowup = (q) => /^(নাম|নামগুলো|নাম বল|নাম বলো|নাম দাও|কি কি|কী কী|কী কি|কোনগুলো|কোন গুলো|কোন কোন|কোনটা|কোনটি|which|which ones|list|list them|show|show me|give me the list|details|বিস্তারিত|আর কি|আর কী|আরও|আরও বল|এগুলো|ওগুলো|এগুলোর নাম|ওগুলোর নাম|তার নাম|তাদের নাম)(\s*(বল|দাও|দেখাও))?$/i.test(normalize(q))

const questionHasVideo = (q) => has(q, /video|videos|content|ভিডিও|কনটেন্ট/)
const questionHasUpload = (q) => has(q, /upload|uploaded|আপলোড/)
const questionHasPost = (q) => has(q, /post|posted|পোস্ট/)
const questionHasSchedule = (q) => has(q, /schedule|scheduled|calendar|শিডিউল|ক্যালেন্ডার|কবে|কখন|তারিখ|সময়|সময়/)
const questionHasTime = (q) => has(q, /কবে|কখন|তারিখ|সময়|সময়|when|date|time/)

const extractChannel = (q) => {
  const m = normalize(q).match(/(?:^|\s)(hhd|bhd|dhd)(?:$|\s)/i)
  return m ? m[1].toUpperCase() : null
}

const extractStage = (q) => {
  const l = normalize(q)
  if (/editing|edited|edit done|edit complete|এডিট|এডিটিং|এডিট করা|এডিটিং করা/.test(l)) return 'editing'
  if (/record|recorded|recorder|রেকর্ড|রেকর্ডেড|রেকর্ডার|রেকর্ড করা/.test(l)) return 'recorder'
  if (/running|in progress|working|রানিং|চলছে|কাজ চলছে/.test(l)) return 'running'
  if (/listed|not set|ready|লিস্টেড|তালিকাভুক্ত|লিস্ট করা/.test(l)) return 'listed'
  return null
}

const unwrapRows = (value) => {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.data)) return value.data
  if (Array.isArray(value?.results)) return value.results
  if (Array.isArray(value?.rows)) return value.rows
  return []
}

const getUsers = (history) => (Array.isArray(history) ? history : []).filter((x) => x?.role === 'user').map((x) => textOf(x.text)).filter(Boolean)
const previousQuestion = (history) => {
  const users = getUsers(history)
  for (let i = users.length - 1; i >= 0; i--) if (!isFollowup(users[i])) return users[i]
  return ''
}
const effectiveQuestion = (q, history) => isFollowup(q) ? previousQuestion(history) : q

function parseDate(value) {
  if (!value) return null
  const raw = textOf(value)
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}

function dhakaDateKey(value) {
  const d = parseDate(value)
  if (!d) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function dhakaDateTime(value) {
  const d = parseDate(value)
  if (!d) return textOf(value) || 'No date'
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
}

function currentDhakaParts() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value),
    month: Number(parts.find((p) => p.type === 'month')?.value),
    day: Number(parts.find((p) => p.type === 'day')?.value),
  }
}

function dateFilterFromQuestion(question) {
  const q = normalize(question)
  const now = currentDhakaParts()
  if (/\btoday\b|আজ|আজকে/.test(q)) return { key: new Date(Date.UTC(now.year, now.month - 1, now.day)).toISOString().slice(0, 10), label: 'Today' }
  if (/\btomorrow\b|আগামীকাল/.test(q)) return { key: new Date(Date.UTC(now.year, now.month - 1, now.day + 1)).toISOString().slice(0, 10), label: 'Tomorrow' }

  const monthMap = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 }
  const named = q.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\b/i)
  if (named) {
    const month = monthMap[named[1].toLowerCase()]
    const day = Number(named[2])
    const year = Number(named[3] || now.year)
    return { key: new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10), label: `${named[1]} ${day}` }
  }

  const numeric = q.match(/(?:^|\s)(\d{1,2})(?:st|nd|rd|th)?\s*(?:তারিখ|date)\b/)
  if (numeric) {
    const day = Number(numeric[1])
    if (day >= 1 && day <= 31) return { key: new Date(Date.UTC(now.year, now.month - 1, day)).toISOString().slice(0, 10), label: `${day} ${new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(now.year, now.month - 1, day))}` }
  }

  const bare = q.match(/\b(?:on|for)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i)
  if (bare) {
    const day = Number(bare[1])
    if (day >= 1 && day <= 31) return { key: new Date(Date.UTC(now.year, now.month - 1, day)).toISOString().slice(0, 10), label: `${day} ${new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(now.year, now.month - 1, day))}` }
  }
  return null
}

function answerVideos(question, history, contents) {
  const original = textOf(question)
  const effective = effectiveQuestion(original, history)
  const q = normalize(original)
  const source = normalize(effective)
  const follow = isFollowup(original)
  if (!questionHasVideo(q) && !follow && !extractChannel(q) && !extractStage(q)) return null

  const channel = extractChannel(q) || extractChannel(source)
  const stage = extractStage(q) || extractStage(source)
  let rows = contents.filter(Boolean)
  if (channel) rows = rows.filter((r) => channelOf(r) === channel)
  if (stage === 'editing') rows = rows.filter(isEditingDone)
  if (stage === 'recorder') rows = rows.filter(isRecorder)
  if (stage === 'running') rows = rows.filter(isRunning)
  if (stage === 'listed') rows = rows.filter(isListed)

  const label = channel ? `${channel} ` : ''
  const stageLabel = stage === 'editing' ? 'Editing Done' : stage === 'recorder' ? 'Recorder' : stage === 'running' ? 'Running' : stage === 'listed' ? 'Listed' : 'Total'
  if (isCountQuestion(original) && !isListQuestion(original)) return `${label}${stageLabel} Videos: ${rows.length}`
  if (isListQuestion(original) || follow) return `${label}${stageLabel === 'Total' ? 'Content' : stageLabel} Videos: ${rows.length}\n\n${rows.length ? rows.map((r, i) => `${i + 1}. ${nameOf(r)}`).join('\n') : 'No matching videos found.'}`
  return null
}

function answerPosts(question, history, posts) {
  const original = textOf(question)
  const effective = effectiveQuestion(original, history)
  const q = normalize(original)
  const source = normalize(effective)
  const uploadIntent = questionHasUpload(q) || questionHasUpload(source)
  const postIntent = questionHasPost(q) || questionHasPost(source)
  if (!uploadIntent && !postIntent) return null

  const channel = extractChannel(q) || extractChannel(source)
  let rows = posts.filter(Boolean)
  if (channel) rows = rows.filter((r) => channelOf(r) === channel)

  // IMPORTANT: Uploaded and Scheduled are different statuses. Never return scheduled rows for an upload question.
  if (uploadIntent) rows = rows.filter((r) => statusOf(r) === 'uploaded' || statusOf(r).includes('upload'))
  if (!uploadIntent && postIntent) rows = rows.filter((r) => statusOf(r) === 'posted' || statusOf(r).includes('post') || statusOf(r).includes('publish'))

  const dateFilter = dateFilterFromQuestion(original) || (isFollowup(original) ? dateFilterFromQuestion(effective) : null)
  if (dateFilter) rows = rows.filter((r) => dhakaDateKey(r.scheduled_at) === dateFilter.key)

  const label = channel ? `${channel} ` : ''
  const statusLabel = uploadIntent ? 'Uploaded' : 'Posted'
  if (isCountQuestion(original) && !isListQuestion(original)) return `${label}${dateFilter ? dateFilter.label + ' ' : ''}${statusLabel} Videos: ${rows.length}`

  return `${label}${dateFilter ? dateFilter.label + ' ' : ''}${statusLabel} Videos: ${rows.length}\n\n${rows.length ? rows.slice(0, 200).map((r, i) => `${i + 1}. ${nameOf(r)}${r.channel ? ` [${r.channel}]` : ''}${r.content_type ? ` — ${r.content_type}` : ''}${r.scheduled_at ? ` — ${dhakaDateTime(r.scheduled_at)}` : ''}`).join('\n') : 'No matching videos found.'}`
}

function answerSchedules(question, history, posts) {
  const original = textOf(question)
  const effective = effectiveQuestion(original, history)
  const q = normalize(original)
  const source = normalize(effective)
  if (questionHasUpload(q) || questionHasPost(q)) return null
  if (!questionHasSchedule(q) && !questionHasSchedule(source)) return null

  const channel = extractChannel(q) || extractChannel(source)
  let rows = posts.filter((p) => statusOf(p) === 'scheduled' && p?.scheduled_at)
  if (channel) rows = rows.filter((p) => channelOf(p) === channel)

  const dateFilter = dateFilterFromQuestion(original) || (isFollowup(original) ? dateFilterFromQuestion(effective) : null)
  if (dateFilter) rows = rows.filter((p) => dhakaDateKey(p.scheduled_at) === dateFilter.key)

  const label = channel ? `${channel} ` : ''
  const dateLabel = dateFilter ? `${dateFilter.label} ` : ''
  if (isCountQuestion(original) && !questionHasTime(original)) return `${label}${dateLabel}Scheduled Posts: ${rows.length}`

  return `${label}${dateLabel}Scheduled Posts: ${rows.length}\n\n${rows.length ? rows.map((p, i) => `${i + 1}. ${nameOf(p)}${p.channel ? ` [${p.channel}]` : ''} — ${dhakaDateTime(p.scheduled_at)}${p.content_type ? ` — ${p.content_type}` : ''}${p.platform ? ` — ${p.platform}` : ''}`).join('\n') : 'No scheduled posts found.'}`
}

function answerByName(question, contents, posts) {
  const q = normalize(question)
  const m = q.match(/\b(?:hhd|bhd|dhd)\s*\d{2,}\b/i)
  if (!m) return null
  const key = m[0].replace(/\s+/g, '').toUpperCase()
  const foundContents = contents.filter((r) => normalize(nameOf(r)).replace(/\s+/g, '') === key)
  const foundPosts = posts.filter((r) => normalize(nameOf(r)).replace(/\s+/g, '') === key)
  if (!foundContents.length && !foundPosts.length) return `No data found for ${key}.`
  const out = []
  foundContents.forEach((r) => out.push(`${nameOf(r)} [${channelOf(r) || 'No channel'}]\nStage: ${isEditingDone(r) ? 'Editing Done' : isRecorder(r) ? 'Recorder' : isListed(r) ? 'Listed' : 'Running'}\nFull Video: ${textOf(r.full_video_status) || 'Not set'}\nShort Ex: ${textOf(r.short_ex_status) || 'Not set'}\nShort Top: ${textOf(r.short_top_status) || 'Not set'}\nStyle Ex: ${textOf(r.style_ex_status) || 'Not set'}\nStyle Top: ${textOf(r.style_top_status) || 'Not set'}`))
  foundPosts.forEach((r) => out.push(`${nameOf(r)} [${channelOf(r) || 'No channel'}]\nStatus: ${textOf(r.status) || 'Not set'}\nScheduled: ${r.scheduled_at ? dhakaDateTime(r.scheduled_at) : 'Not scheduled'}\nContent Type: ${textOf(r.content_type) || 'Not set'}\nPlatform: ${textOf(r.platform) || 'Not set'}`))
  return out.join('\n\n')
}

function answerSummary(question, contents, posts) {
  if (!/(summary|overview|dashboard|সব|all data|সামগ্রিক|সারাংশ|ড্যাশবোর্ড)/.test(normalize(question))) return null
  const channels = ['HHD', 'BHD', 'DHD'].map((c) => {
    const rows = contents.filter((r) => channelOf(r) === c)
    return `${c}: ${rows.length} total, ${rows.filter(isListed).length} listed, ${rows.filter(isRecorder).length} recorder, ${rows.filter(isRunning).length} running, ${rows.filter(isEditingDone).length} editing done`
  })
  return `Content Summary\n\n${channels.join('\n')}\n\nTotal content: ${contents.length}\nTotal posts: ${posts.length}`
}

function buildAnswer(question, history, contents, posts) {
  // Specific intents must run before generic schedule/date detection.
  return answerByName(question, contents, posts) ||
    answerPosts(question, history, posts) ||
    answerSchedules(question, history, posts) ||
    answerVideos(question, history, contents) ||
    answerSummary(question, contents, posts)
}

export default function Chatbot() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([{ role: 'assistant', text: 'Hi! আমি আপনার Content App-এর live data assistant। Content, video, recording, editing, schedule, post, channel, status, date, time, name—সব data নিয়ে প্রশ্ন করতে পারবেন।' }])
  const [loading, setLoading] = useState(false)
  const endRef = useRef(null)

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading, open])

  const ask = async (value) => {
    const question = textOf(value)
    if (!question || loading) return
    const history = messages.slice(-20)
    setMessage('')
    setMessages((current) => [...current, { role: 'user', text: question }])
    setLoading(true)
    try {
      const [contentsResult, postsResult] = await Promise.all([api.get('/contents'), api.get('/posts')])
      const contents = unwrapRows(contentsResult?.data)
      const posts = unwrapRows(postsResult?.data)
      const localAnswer = buildAnswer(question, history, contents, posts)

      // Do not send recognizable data questions to the generic AI endpoint.
      const recognized = questionHasVideo(question) || questionHasUpload(question) || questionHasPost(question) || questionHasSchedule(question) || extractChannel(question) || extractStage(question) || isFollowup(question) || isCountQuestion(question)
      let serverAnswer = ''
      if (!localAnswer && !recognized) {
        try {
          const response = await api.post('/chat', { message: question, history })
          serverAnswer = response?.data?.answer || response?.data?.message || ''
        } catch {}
      }
      const answer = localAnswer || serverAnswer || 'এই প্রশ্নের জন্য live data থেকে কোনো উত্তর পাওয়া যায়নি।'
      setMessages((current) => [...current, { role: 'assistant', text: String(answer) }])
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', text: `Live data load failed: ${error?.message || 'Unknown error'}` }])
    } finally { setLoading(false) }
  }

  const submit = (e) => { e.preventDefault(); ask(message) }
  if (!open) return <button onClick={() => setOpen(true)} aria-label="Open App Assistant" title="Open App Assistant" style={{ position: 'fixed', right: 24, bottom: 24, width: 58, height: 58, border: 0, borderRadius: '50%', background: '#6c5ce7', color: '#fff', cursor: 'pointer', boxShadow: '0 10px 30px rgba(0,0,0,.18)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}><span style={{ fontSize: 24, lineHeight: 1 }}>💬</span></button>

  return <div style={{ position: 'fixed', right: 24, bottom: 24, width: 360, maxWidth: 'calc(100vw - 32px)', height: 560, maxHeight: 'calc(100vh - 48px)', background: '#fff', borderRadius: 18, boxShadow: '0 18px 60px rgba(0,0,0,.22)', overflow: 'hidden', zIndex: 1000, display: 'flex', flexDirection: 'column', border: '1px solid #e8e8ef' }}>
    <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #eee' }}>
      <div><div style={{ fontWeight: 800 }}>App Assistant</div><div style={{ fontSize: 12, color: '#777' }}>Live app data • Follow-up aware</div></div>
      <button onClick={() => setOpen(false)} style={{ border: 0, background: 'transparent', fontSize: 22, cursor: 'pointer', color: '#777' }}>×</button>
    </div>
    <div style={{ flex: 1, overflowY: 'auto', padding: 14, background: '#fafafe' }}>
      {messages.map((item, index) => <div key={index} style={{ display: 'flex', justifyContent: item.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}><div style={{ maxWidth: '92%', whiteSpace: 'pre-wrap', lineHeight: 1.5, padding: '10px 12px', borderRadius: 12, background: item.role === 'user' ? '#6c5ce7' : '#fff', color: item.role === 'user' ? '#fff' : '#20202a', border: item.role === 'assistant' ? '1px solid #eee' : 'none', fontSize: 13 }}>{item.text}</div></div>)}
      {messages.length === 1 && !loading && <div style={{ marginTop: 10 }}>{starterQuestions.map((item, index) => <button key={index} onClick={() => ask(item)} style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 7, padding: '9px 10px', border: '1px solid #e5e2ff', borderRadius: 10, background: '#fff', color: '#4f46b8', cursor: 'pointer', fontSize: 12 }}>{item}</button>)}</div>}
      {loading && <div style={{ fontSize: 12, color: '#777' }}>Live data checking…</div>}
      <div ref={endRef} />
    </div>
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #eee', background: '#fff' }}>
      <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ask about videos, posts, schedule, status..." disabled={loading} style={{ flex: 1, minWidth: 0, border: '1px solid #ddd', borderRadius: 10, padding: '10px 11px', outline: 'none' }} />
      <button type="submit" disabled={loading || !message.trim()} style={{ width: 42, border: 0, borderRadius: 10, background: '#6c5ce7', color: '#fff', cursor: 'pointer', fontSize: 18 }}>➤</button>
    </form>
  </div>
}