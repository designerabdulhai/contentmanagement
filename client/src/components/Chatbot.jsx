import React, { useEffect, useRef, useState } from 'react'
import api from '../api'

const starterQuestions = [
  'BHD তে কয়টা ভিডিও রেকর্ড করা আছে?',
  'HHD তে কয়টা ভিডিও রেকর্ড করা আছে?',
  'কয়টি ভিডিও শিডিউল করা আছে? কবে এবং কখন?',
  'এডিটিং করা আছে মোট কয়টি ভিডিও?',
]

const VIDEO_FIELDS = [
  'full_video_status',
  'short_ex_status',
  'short_top_status',
  'style_ex_status',
  'style_top_status',
]

const normalize = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[।?？!！,，:：;；|()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const textOf = (value) => String(value ?? '').trim()
const channelOf = (row) => textOf(row?.channel).toUpperCase()
const nameOf = (row) => textOf(row?.name || row?.project_name || row?.project || row?.title || 'Untitled')

const statusesOf = (row) => VIDEO_FIELDS.map((key) => textOf(row?.[key]).toLowerCase())
const isListed = (row) => statusesOf(row).every((value) => value === '' || value === 'not set')
const isRecorder = (row) => statusesOf(row).every((value) => value === 'record')
const isEditingDone = (row) => statusesOf(row).some((value) =>
  ['editing done', 'edited', 'edit done'].includes(value) || value.includes('editing done')
)
const isRunning = (row) => !isListed(row) && !isRecorder(row) && statusesOf(row).some(Boolean)

const isCountQuestion = (q) =>
  /how many|how much|count|total|number|কত|কয়|কয়|কয়টি|কয়টি|কয়টা|কয়টা|সংখ্যা|মোট/.test(normalize(q))

const isListQuestion = (q) =>
  /show|list|which|what|give|name|names|বল|নাম|দেখাও|লিস্ট|তালিকা|কি কি|কী কী|কোন কোন|কোনগুলো|কোন গুলো|কারা|কোনটা|কোনটি/.test(normalize(q))

const isFollowup = (q) => {
  const l = normalize(q)
  return /^(নাম|নামগুলো|নাম বল|নাম বলো|নাম দাও|কি কি|কী কী|কী কি|কোনগুলো|কোন গুলো|কোন কোন|কোনটা|কোনটি|which|which ones|list|list them|show|show me|give me the list|details|বিস্তারিত|আর কি|আর কী|আরও|আরও বল|এগুলো|ওগুলো|এগুলোর নাম|ওগুলোর নাম|তার নাম|তাদের নাম)(\s*(বল|দাও|দেখাও))?$/.test(l)
}

const extractChannel = (q) => {
  const l = normalize(q)
  const match = l.match(/(?:^|\s)(hhd|bhd|dhd)(?:$|\s)/i)
  return match ? match[1].toUpperCase() : null
}

const extractStage = (q) => {
  const l = normalize(q)
  if (/editing|edited|edit done|edit complete|এডিট|এডিটিং|এডিট করা|এডিটিং করা/.test(l)) return 'editing'
  if (/record|recorded|recorder|রেকর্ড|রেকর্ডেড|রেকর্ডার|রেকর্ড করা/.test(l)) return 'recorder'
  if (/running|in progress|working|রানিং|চলছে|কাজ চলছে/.test(l)) return 'running'
  if (/listed|not set|ready|লিস্টেড|তালিকাভুক্ত|লিস্ট করা/.test(l)) return 'listed'
  return null
}

const getHistoryUsers = (history) =>
  (Array.isArray(history) ? history : [])
    .filter((item) => item?.role === 'user')
    .map((item) => textOf(item.text))
    .filter(Boolean)

const previousMeaningfulQuestion = (history) => {
  const users = getHistoryUsers(history)
  for (let i = users.length - 1; i >= 0; i -= 1) {
    if (!isFollowup(users[i])) return users[i]
  }
  return ''
}

const inheritedQuestion = (question, history) =>
  isFollowup(question) ? previousMeaningfulQuestion(history) : question

const unwrapRows = (value) => {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.data)) return value.data
  if (Array.isArray(value?.results)) return value.results
  if (Array.isArray(value?.rows)) return value.rows
  return []
}

const dateValue = (value) => {
  if (!value) return null
  const raw = textOf(value)
  const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const dhakaDateKey = (value) => {
  const d = dateValue(value)
  if (!d) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

const dhakaDateTime = (value) => {
  const d = dateValue(value)
  if (!d) return textOf(value) || 'No date'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d)
}

const todayDhaka = (offset = 0) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const year = Number(parts.find((p) => p.type === 'year')?.value)
  const month = Number(parts.find((p) => p.type === 'month')?.value)
  const day = Number(parts.find((p) => p.type === 'day')?.value)
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10)
}

const questionHasVideo = (q) => /video|videos|content|ভিডিও|কনটেন্ট/.test(normalize(q))

const answerVideos = (question, history, contents) => {
  const original = textOf(question)
  const effective = inheritedQuestion(original, history)
  const q = normalize(original)
  const source = normalize(effective)
  const follow = isFollowup(original)

  if (!questionHasVideo(q) && !follow && !extractChannel(q) && !extractStage(q)) return null

  const channel = extractChannel(q) || extractChannel(source)
  const stage = extractStage(q) || extractStage(source)
  let rows = contents.filter(Boolean)
  if (channel) rows = rows.filter((row) => channelOf(row) === channel)

  if (stage === 'editing') rows = rows.filter(isEditingDone)
  if (stage === 'recorder') rows = rows.filter(isRecorder)
  if (stage === 'running') rows = rows.filter(isRunning)
  if (stage === 'listed') rows = rows.filter(isListed)

  const label = channel ? `${channel} ` : ''
  const stageLabel = stage === 'editing' ? 'Editing Done' : stage === 'recorder' ? 'Recorder' : stage === 'running' ? 'Running' : stage === 'listed' ? 'Listed' : 'Total'

  if (isCountQuestion(q) && !isListQuestion(q)) return `${label}${stageLabel} Videos: ${rows.length}`

  if (isListQuestion(q) || follow) {
    return `${label}${stageLabel === 'Total' ? 'Content' : stageLabel} Videos: ${rows.length}\n\n${rows.length ? rows.map((row, i) => `${i + 1}. ${nameOf(row)}`).join('\n') : 'No matching videos found.'}`
  }
  return null
}

const answerSchedules = (question, history, posts) => {
  const original = textOf(question)
  const q = normalize(original)
  const effective = inheritedQuestion(original, history)
  const source = normalize(effective)
  const scheduleIntent =
    /schedule|scheduled|calendar|শিডিউল|ক্যালেন্ডার|কবে|কখন|তারিখ|সময়|সময়|today|tomorrow|আজ|আজকে|আগামীকাল/.test(q) ||
    /schedule|scheduled|calendar|শিডিউল|ক্যালেন্ডার|কবে|কখন|তারিখ|সময়|সময়/.test(source)

  if (!scheduleIntent) return null

  const channel = extractChannel(q) || extractChannel(source)
  let rows = posts.filter((post) => textOf(post?.status).toLowerCase() === 'scheduled' && post?.scheduled_at)
  if (channel) rows = rows.filter((post) => channelOf(post) === channel)

  const today = /\btoday\b|আজ|আজকে/.test(q)
  const tomorrow = /\btomorrow\b|আগামীকাল/.test(q)
  if (today || tomorrow) {
    const key = todayDhaka(tomorrow ? 1 : 0)
    rows = rows.filter((post) => dhakaDateKey(post.scheduled_at) === key)
  }

  const label = channel ? `${channel} ` : ''
  const dayLabel = tomorrow ? 'Tomorrow ' : today ? 'Today ' : ''
  return `${label}${dayLabel}Scheduled Posts: ${rows.length}\n\n${rows.length ? rows.map((post, i) => `${i + 1}. ${nameOf(post)}${post.channel ? ` [${post.channel}]` : ''} — ${dhakaDateTime(post.scheduled_at)}${post.content_type ? ` — ${post.content_type}` : ''}${post.platform ? ` — ${post.platform}` : ''}`).join('\n') : 'No scheduled posts found.'}`
}

const answerPosts = (question, history, posts) => {
  const original = textOf(question)
  const q = normalize(original)
  const effective = inheritedQuestion(original, history)
  const source = normalize(effective)
  const postIntent = /post|posted|upload|uploaded|link|পোস্ট|আপলোড|লিংক|স্ট্যাটাস|status/.test(q) || /post|posted|upload|uploaded|পোস্ট|আপলোড|স্ট্যাটাস|status/.test(source)
  if (!postIntent) return null

  const channel = extractChannel(q) || extractChannel(source)
  let rows = posts.filter(Boolean)
  if (channel) rows = rows.filter((post) => channelOf(post) === channel)

  if (/uploaded|upload|আপলোড/.test(q)) rows = rows.filter((post) => /uploaded|upload/.test(textOf(post.status).toLowerCase()))
  else if (/posted|post|পোস্ট/.test(q) && !/status|স্ট্যাটাস/.test(q)) rows = rows.filter((post) => /posted|post/.test(textOf(post.status).toLowerCase()))

  const label = channel ? `${channel} ` : ''
  if (isCountQuestion(q) && !isListQuestion(q)) return `${label}Posts: ${rows.length}`

  return `${label}Posts: ${rows.length}\n\n${rows.length ? rows.slice(0, 200).map((post, i) => `${i + 1}. ${nameOf(post)}${post.channel ? ` [${post.channel}]` : ''} — ${post.status || 'Not set'}${post.content_type ? ` — ${post.content_type}` : ''}`).join('\n') : 'No matching posts found.'}`
}

const answerByName = (question, contents, posts) => {
  const q = normalize(question)
  const candidates = [...contents, ...posts]
  const idMatch = q.match(/\b(hhd|bhd|dhd)\s*\d{2,}\b/i)
  if (!idMatch) return null
  const key = idMatch[0].replace(/\s+/g, '').toUpperCase()
  const found = candidates.filter((row) => normalize(nameOf(row)).replace(/\s+/g, '') === key)
  if (!found.length) return `No data found for ${key}.`

  return found.map((row) => {
    if (contents.includes(row)) {
      return `${nameOf(row)} [${channelOf(row) || 'No channel'}]\nStage: ${isEditingDone(row) ? 'Editing Done' : stageOf(row)}\nFull Video: ${textOf(row.full_video_status) || 'Not set'}\nShort Ex: ${textOf(row.short_ex_status) || 'Not set'}\nShort Top: ${textOf(row.short_top_status) || 'Not set'}\nStyle Ex: ${textOf(row.style_ex_status) || 'Not set'}\nStyle Top: ${textOf(row.style_top_status) || 'Not set'}`
    }
    return `${nameOf(row)} [${channelOf(row) || 'No channel'}]\nStatus: ${textOf(row.status) || 'Not set'}\nScheduled: ${row.scheduled_at ? dhakaDateTime(row.scheduled_at) : 'Not scheduled'}\nContent Type: ${textOf(row.content_type) || 'Not set'}\nPlatform: ${textOf(row.platform) || 'Not set'}`
  }).join('\n\n')
}

const stageOf = (row) => {
  if (isListed(row)) return 'Listed'
  if (isRecorder(row)) return 'Recorder'
  return 'Running'
}

const answerSummary = (question, contents, posts) => {
  const q = normalize(question)
  if (!/(summary|overview|dashboard|সব|all data|সামগ্রিক|সারাংশ|ড্যাশবোর্ড)/.test(q)) return null
  const channels = ['HHD', 'BHD', 'DHD'].map((channel) => {
    const rows = contents.filter((row) => channelOf(row) === channel)
    return `${channel}: ${rows.length} total, ${rows.filter(isListed).length} listed, ${rows.filter(isRecorder).length} recorder, ${rows.filter(isRunning).length} running, ${rows.filter(isEditingDone).length} editing done`
  })
  return `Content Summary\n\n${channels.join('\n')}\n\nTotal content: ${contents.length}\nTotal posts: ${posts.length}`
}

const buildLocalAnswer = (question, history, contents, posts) =>
  answerByName(question, contents, posts) ||
  answerSchedules(question, history, posts) ||
  answerVideos(question, history, contents) ||
  answerPosts(question, history, posts) ||
  answerSummary(question, contents, posts)

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
      // Always read the same live endpoints used by the app before answering.
      // This prevents stale/incorrect chatbot context from overriding real DB data.
      const [contentsResult, postsResult] = await Promise.all([api.get('/contents'), api.get('/posts')])
      const contents = unwrapRows(contentsResult?.data)
      const posts = unwrapRows(postsResult?.data)
      const localAnswer = buildLocalAnswer(question, history, contents, posts)

      let serverAnswer = ''
      try {
        const response = await api.post('/chat', { message: question, history })
        serverAnswer = response?.data?.answer || response?.data?.message || ''
      } catch {
        // Deterministic live-data answer is the fallback for server errors.
      }

      const dataIntent = questionHasVideo(question) || extractChannel(question) || extractStage(question) || /schedule|scheduled|calendar|শিডিউল|ক্যালেন্ডার|কবে|কখন|তারিখ|সময়|সময়|today|tomorrow|আজ|আজকে|আগামীকাল|post|posted|upload|uploaded|পোস্ট|আপলোড|status|স্ট্যাটাস/.test(normalize(question)) || isFollowup(question)
      const answer = localAnswer || (dataIntent ? '' : serverAnswer) || 'এই প্রশ্নের জন্য live data থেকে কোনো উত্তর পাওয়া যায়নি।'

      setMessages((current) => [...current, { role: 'assistant', text: String(answer) }])
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', text: `Live data load failed: ${error?.message || 'Unknown error'}` }])
    } finally {
      setLoading(false)
    }
  }

  const submit = (event) => { event.preventDefault(); ask(message) }

  if (!open) return (
    <button onClick={() => setOpen(true)} aria-label="Open App Assistant" title="Open App Assistant" style={{ position: 'fixed', right: 24, bottom: 24, width: 58, height: 58, border: 0, borderRadius: '50%', background: '#6c5ce7', color: '#fff', cursor: 'pointer', boxShadow: '0 10px 30px rgba(0,0,0,.18)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>
      <span style={{ fontSize: 24, lineHeight: 1 }} aria-hidden="true">💬</span>
    </button>
  )

  return (
    <div style={{ position: 'fixed', right: 24, bottom: 24, width: 360, maxWidth: 'calc(100vw - 32px)', height: 560, maxHeight: 'calc(100vh - 48px)', background: '#fff', borderRadius: 18, boxShadow: '0 18px 60px rgba(0,0,0,.22)', overflow: 'hidden', zIndex: 1000, display: 'flex', flexDirection: 'column', border: '1px solid #e8e8ef' }}>
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #eee' }}>
        <div><div style={{ fontWeight: 800 }}>App Assistant</div><div style={{ fontSize: 12, color: '#777' }}>Live app data • Follow-up aware</div></div>
        <button onClick={() => setOpen(false)} style={{ border: 0, background: 'transparent', fontSize: 22, cursor: 'pointer', color: '#777' }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14, background: '#fafafe' }}>
        {messages.map((item, index) => (
          <div key={index} style={{ display: 'flex', justifyContent: item.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
            <div style={{ maxWidth: '92%', whiteSpace: 'pre-wrap', lineHeight: 1.5, padding: '10px 12px', borderRadius: 12, background: item.role === 'user' ? '#6c5ce7' : '#fff', color: item.role === 'user' ? '#fff' : '#20202a', border: item.role === 'assistant' ? '1px solid #eee' : 'none', fontSize: 13 }}>{item.text}</div>
          </div>
        ))}
        {messages.length === 1 && !loading && <div style={{ marginTop: 10 }}>{starterQuestions.map((item, index) => <button key={index} onClick={() => ask(item)} style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 7, padding: '9px 10px', border: '1px solid #e5e2ff', borderRadius: 10, background: '#fff', color: '#4f46b8', cursor: 'pointer', fontSize: 12 }}>{item}</button>)}</div>}
        {loading && <div style={{ fontSize: 12, color: '#777' }}>Live data checking…</div>}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #eee', background: '#fff' }}>
        <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask about videos, posts, schedule, status..." disabled={loading} style={{ flex: 1, minWidth: 0, border: '1px solid #ddd', borderRadius: 10, padding: '10px 11px', outline: 'none' }} />
        <button type="submit" disabled={loading || !message.trim()} style={{ width: 42, border: 0, borderRadius: 10, background: '#6c5ce7', color: '#fff', cursor: 'pointer', fontSize: 18 }}>➤</button>
      </form>
    </div>
  )
}
