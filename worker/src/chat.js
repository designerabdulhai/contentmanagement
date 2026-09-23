const CORS={"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:CORS});
const tokenFromRequest=r=>{const h=String(r.headers.get("Authorization")||"");return h.startsWith("Bearer ")?h.slice(7).trim():""};
function b64(v){v=String(v||"").replace(/-/g,"+").replace(/_/g,"/");return atob(v+"=".repeat((4-v.length%4)%4))}
async function sha(v){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(v)));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function auth(r,db){const t=tokenFromRequest(r),p=t.split(".");if(p.length!==2)return null;try{const [idText,expText]=b64(p[0]).split("."),id=Number(idText),exp=Number(expText);if(!Number.isInteger(id)||!Number.isFinite(exp)||exp<=Date.now()/1000)return null;const u=await db.prepare("SELECT id,email,password_hash FROM users WHERE id=? LIMIT 1").bind(id).first();if(!u?.password_hash)return null;return await sha(`${b64(p[0])}.${u.password_hash}`)===p[1]?u:null}catch{return null}}

const VIDEO_FIELDS=["full_video_status","short_ex_status","short_top_status","style_ex_status","style_top_status"];
const normalize=v=>String(v??"").normalize("NFKC").toLowerCase().replace(/[।?？!！,，:：;]/g," ").replace(/\s+/g," ").trim();
const channelOf=x=>String(x?.channel||"").trim().toUpperCase();
const nameOf=x=>String(x?.name||x?.project_name||x?.project||"Untitled");
const statusOf=x=>String(x?.status||"").trim().toLowerCase();
const fieldStatus=x=>VIDEO_FIELDS.map(k=>String(x?.[k]??"").trim().toLowerCase());
const isCount=q=>/how\s*many|count|total|number|কত|কয়|কয়|কয়টি|কয়টি|কয়টা|কয়টা|সংখ্যা|মোট/.test(normalize(q));
const wantsList=q=>/show|list|which|what|give|name|names|বল|নাম|দেখাও|লিস্ট|তালিকা|কি\s*কি|কী\s*কী|কোন\s*কোন|কোনগুলো|কোন গুলো/.test(normalize(q));
const getChannel=q=>{const l=normalize(q);const m=l.match(/(?:^|[^a-z])(hhd|bhd|dhd)(?:$|[^a-z])/i);return m?m[1].toUpperCase():null};
const isListedVideo=x=>fieldStatus(x).every(v=>v==="");
const isRecorderVideo=x=>fieldStatus(x).every(v=>v==="record");
const isRunningVideo=x=>!isListedVideo(x)&&!isRecorderVideo(x)&&fieldStatus(x).some(Boolean);
const stageOf=x=>isListedVideo(x)?"Listed":isRecorderVideo(x)?"Recorder":"Running";
const isEditingDone=x=>fieldStatus(x).some(v=>v==="editing done"||v==="edited"||v==="edit done"||v.includes("editing done"));

function parseDhakaDate(value){
  if(!value)return null; const s=String(value).trim(); if(!s)return null;
  if(/Z$|[+-]\d\d:?\d\d$/.test(s)){const ms=Date.parse(s);return Number.isNaN(ms)?null:new Date(ms)}
  const m=s.replace("T"," ").match(/^(\d{4})-(\d{2})-(\d{2})[ ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if(m){const [,y,mo,d,h,mi,se="00"]=m;return new Date(Date.UTC(+y,+mo-1,+d,+h-6,+mi,+se))}
  const d=new Date(s);return Number.isNaN(d.getTime())?null:d;
}
function dhakaKey(v){const d=parseDhakaDate(v);return d?new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Dhaka",year:"numeric",month:"2-digit",day:"2-digit"}).format(d):null}
function dhakaDateTime(v){const d=parseDhakaDate(v);if(!d)return String(v||"");return new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Dhaka",day:"2-digit",month:"short",year:"numeric",hour:"numeric",minute:"2-digit",hour12:true}).format(d)}
function todayKey(offset=0){const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Dhaka",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const y=+p.find(x=>x.type==="year").value,m=+p.find(x=>x.type==="month").value,d=+p.find(x=>x.type==="day").value;return new Date(Date.UTC(y,m-1,d+offset)).toISOString().slice(0,10)}

function historyUsers(history){return (Array.isArray(history)?history:[]).filter(x=>String(x?.role||"")==="user").map(x=>normalize(x?.text||""));}
function previousUser(history){const a=historyUsers(history);return a[a.length-1]||""}
function isFollowupQuestion(q){const l=normalize(q);if(!l)return false;return /^(নাম|নামগুলো|নাম বল|নাম বলো|কি কি|কী কী|কী কি|কোনগুলো|কোন গুলো|কোন কোন|which|what|which ones|list|list them|show|show me|give me the list|details|বিস্তারিত|আর কি|আর কী|আরও|এগুলো|ওগুলো)$/.test(l)||/^(নাম|কি কি|কী কী|কোনগুলো|কোন গুলো|which|list|details|বিস্তারিত)\s*(বল|দাও|দেখাও)?$/.test(l)}
function followupKind(q,history){
  if(!isFollowupQuestion(q))return null;
  const prev=previousUser(history);if(!prev)return "general";
  if(/edit|editing|edited|এডিট|এডিটিং/.test(prev))return "editing";
  if(/record|recorded|recorder|রেকর্ড|রেকর্ডেড|রেকর্ডার/.test(prev))return "recorded";
  if(/running|in\s*progress|working|রানিং|চলছে/.test(prev))return "running";
  if(/listed|not\s*set|ready|লিস্টেড|তালিকাভুক্ত/.test(prev))return "listed";
  if(/schedule|scheduled|calendar|শিডিউল|ক্যালেন্ডার|কবে|কখন/.test(prev))return "scheduled";
  if(/post|posted|upload|আপলোড|পোস্ট/.test(prev))return "posts";
  return "general";
}
function inheritedChannel(q,history){return getChannel(q)||getChannel(previousUser(history))||null}

function videoAnswer(q,contents,history){
  const l=normalize(q),follow=followupKind(q,history),channel=inheritedChannel(q,history);
  const asksVideo=/video|content|ভিডিও|কনটেন্ট/.test(l)||!!follow;if(!asksVideo)return null;
  let stage=null;
  if(/listed|not\s*set|ready|লিস্টেড|তালিকাভুক্ত/.test(l))stage="Listed";
  else if(/record|recorded|recorder|রেকর্ড|রেকর্ডেড|রেকর্ডার/.test(l))stage="Recorder";
  else if(/running|in\s*progress|working|রানিং|চলছে/.test(l))stage="Running";
  if(follow==="recorded")stage="Recorder";if(follow==="running")stage="Running";if(follow==="listed")stage="Listed";
  const rows=contents.filter(x=>!channel||channelOf(x)===channel);
  if(follow==="editing"||/edit|editing|এডিট|এডিটিং/.test(l)){
    const matching=rows.filter(isEditingDone);if(isCount(l)&&!wantsList(l))return `${channel?channel+" ":""}Total Editing Done Videos: ${matching.length}`;
    return `${channel?channel+" ":""}Editing Done Videos: ${matching.length}\n\n${matching.length?matching.map((x,i)=>`${i+1}. ${nameOf(x)}`).join("\n"):"No editing-done videos found."}`;
  }
  if(stage){const matching=rows.filter(x=>stageOf(x)===stage);if(isCount(l)&&!wantsList(l))return `${channel?channel+" ":""}${stage} Video: ${matching.length}`;return `${channel?channel+" ":""}${stage} Video: ${matching.length}\n\n${matching.length?matching.map((x,i)=>`${i+1}. ${nameOf(x)}`).join("\n"):"No matching videos found."}`}
  if(isCount(l)&&!wantsList(l))return `${channel?channel+" ":""}Total Content: ${rows.length}`;
  if(wantsList(l)||follow)return `${channel?channel+" ":""}Content: ${rows.length}\n\n${rows.length?rows.map((x,i)=>`${i+1}. ${nameOf(x)} — ${stageOf(x)}`).join("\n"):"No content found."}`;
  return null;
}

function scheduleAnswer(q,posts,history){
  const l=normalize(q),follow=followupKind(q,history);if(follow!=="scheduled"&&!/schedule|scheduled|calendar|শিডিউল|ক্যালেন্ডার|কবে|কখন|তারিখ|সময়|সময়|today|tomorrow|আজ|আজকে|আগামীকাল/.test(l))return null;
  const ch=inheritedChannel(q,history),all=posts.filter(p=>statusOf(p)==="scheduled"&&p?.scheduled_at&&(!ch||channelOf(p)===ch));
  const today=/\btoday\b|আজ|আজকে/.test(l),tomorrow=/\btomorrow\b|আগামীকাল/.test(l),when=/when|date|time|কবে|কখন|তারিখ|সময়|সময়/.test(l);
  const list=(today||tomorrow)?all.filter(p=>dhakaKey(p.scheduled_at)===todayKey(tomorrow?1:0)):all;
  if(today||tomorrow||when||wantsList(l)||follow==="scheduled")return `${ch?ch+" ":""}${tomorrow?"Tomorrow ":today?"Today ":""}Scheduled Posts: ${list.length}\n\n${list.length?list.map((p,i)=>`${i+1}. ${p.project_name||"Untitled"}${p.channel?` [${p.channel}]`:""} — ${dhakaDateTime(p.scheduled_at)}${p.content_type?` — ${p.content_type}`:""}${p.platform?` — ${p.platform}`:""}`).join("\n"):"No scheduled posts found."}`;
  return `${ch?ch+" ":""}Total Scheduled Posts: ${all.length}`;
}

function postAnswer(q,posts,history){
  const l=normalize(q),follow=followupKind(q,history);if(follow!=="posts"&&!/post|posted|uploaded|upload|link|পোস্ট|আপলোড|লিংক|স্ট্যাটাস|status/.test(l))return null;
  const ch=inheritedChannel(q,history),rows=posts.filter(p=>!ch||channelOf(p)===ch);
  if(/uploaded|upload|আপলোড/.test(l)){const a=rows.filter(p=>/uploaded|upload/.test(statusOf(p)));return `${ch?ch+" ":""}Uploaded Posts: ${a.length}${wantsList(l)?`\n\n${a.map((p,i)=>`${i+1}. ${p.project_name||"Untitled"}`).join("\n")}`:""}`}
  if(/status|স্ট্যাটাস/.test(l)&&wantsList(l))return rows.length?rows.map((p,i)=>`${i+1}. ${p.project_name||"Untitled"} — ${p.status||"Not set"}`).join("\n"):"No posts found.";
  if(isCount(l)&&!wantsList(l))return `${ch?ch+" ":""}Total Posts: ${rows.length}`;
  return `${ch?ch+" ":""}Posts: ${rows.length}\n\n${rows.slice(0,100).map((p,i)=>`${i+1}. ${p.project_name||"Untitled"} — ${p.status||"Not set"}`).join("\n")}`;
}

function buildSummary(contents,posts){const channelSummary=Object.fromEntries(["HHD","BHD","DHD"].map(c=>{const a=contents.filter(x=>channelOf(x)===c);return[c,{total:a.length,listed:a.filter(isListedVideo).length,recorder:a.filter(isRecorderVideo).length,running:a.filter(isRunningVideo).length,editing_done:a.filter(isEditingDone).length}]}));const scheduled=posts.filter(p=>statusOf(p)==="scheduled"&&p.scheduled_at);return{channels:channelSummary,total_contents:contents.length,total_posts:posts.length,total_scheduled:scheduled.length,scheduled_today:scheduled.filter(p=>dhakaKey(p.scheduled_at)===todayKey()).length,scheduled_tomorrow:scheduled.filter(p=>dhakaKey(p.scheduled_at)===todayKey(1)).length,content_types:[...new Set(posts.map(p=>p.content_type).filter(Boolean))],platforms:[...new Set(posts.map(p=>p.platform).filter(Boolean))]}}
function text(r){return(r?.output||[]).flatMap(x=>x?.content||[]).filter(x=>x?.type==="output_text").map(x=>x.text).join("\n").trim()}

export async function handleChat(request,env){
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  if(request.method!=="POST")return json({error:"method not allowed"},405);
  if(!env?.DB)return json({error:"D1 binding DB is not configured"},500);
  if(!await auth(request,env.DB))return json({error:"authentication required"},401);
  const body=await request.json().catch(()=>({})),q=String(body.message||"").trim(),history=Array.isArray(body.history)?body.history.slice(-20):[];
  if(!q)return json({error:"message required"},400);if(q.length>2000)return json({error:"message is too long"},400);
  const [cr,pr]=await Promise.all([
    env.DB.prepare("SELECT id,name,channel,full_video_status,short_ex_status,short_top_status,style_ex_status,style_top_status,poster_status FROM contents ORDER BY id DESC LIMIT 5000").all(),
    env.DB.prepare("SELECT id,project_name,content_type,channel,platform,status,scheduled_at,uploaded_link FROM posts ORDER BY id DESC LIMIT 10000").all()
  ]);
  const contents=cr.results||[],posts=pr.results||[];
  const direct=videoAnswer(q,contents,history)||scheduleAnswer(q,posts,history)||postAnswer(q,posts,history);if(direct)return json({answer:direct});
  const key=String(env.OPENAI_API_KEY||"").trim();
  if(!key)return json({answer:"প্রশ্নটি বুঝতে পারিনি। Content, video, recording, editing, schedule, post, channel, status, date, time বা name সম্পর্কে প্রশ্ন করুন।"});
  const ctx={summary:buildSummary(contents,posts),contents,posts};
  const previous=history.filter(x=>x?.role&&x?.text).map(x=>`${x.role}: ${x.text}`).join("\n");
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:String(env.OPENAI_MODEL||"gpt-5.6-luna"),instructions:"You are the private live-data assistant for a Content Schedule Manager. Use ONLY the LIVE DATABASE DATA supplied in this request. Never invent or estimate data. Understand Bangla, Banglish and English. Preserve context across follow-up questions. A short follow-up like নাম, নাম বল, নামগুলো, কি কি, কোনগুলো, which, list, details refers to the most recent user question and inherits its channel, status and intent unless the user explicitly changes them. If the question asks for a count, return the exact count from live data. If it asks for names/details, list the matching records. HHD, BHD and DHD are channels. A Recorder video means all five video status fields are Record. A Listed video means all five video status fields are empty. A Running video is a content row that is neither Listed nor Recorder and has at least one non-empty video status. An Editing Done video has at least one of the five video status fields containing Editing Done, Edited, or Edit Done. Scheduled posts are posts with status Scheduled and scheduled_at present. Dates and times are Asia/Dhaka. If a requested field is absent from the live data, say it is not available. Never say not found merely because wording differs. Read-only assistant.",input:`CURRENT QUESTION:\n${q}\n\nRECENT CONVERSATION:\n${previous||"none"}\n\nLIVE DATABASE DATA:\n${JSON.stringify(ctx)}`,store:false,max_output_tokens:2200})});
  const raw=await response.text();if(!response.ok){let e="AI request failed";try{e=JSON.parse(raw)?.error?.message||e}catch{}return json({error:e},502)}
  const answer=text(JSON.parse(raw));return answer?json({answer}):json({answer:"এই প্রশ্নের কোনো উত্তর পাওয়া যায়নি।"});
}
