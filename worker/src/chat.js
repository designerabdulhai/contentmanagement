const CORS={"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:CORS});

const tokenFromRequest=r=>{const h=String(r.headers.get("Authorization")||"");return h.startsWith("Bearer ")?h.slice(7).trim():""};
function b64(v){v=String(v||"").replace(/-/g,"+").replace(/_/g,"/");return atob(v+"=".repeat((4-v.length%4)%4))}
async function sha(v){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(v)));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function auth(r,db){const t=tokenFromRequest(r),p=t.split(".");if(p.length!==2)return null;try{const [idText,expText]=b64(p[0]).split("."),id=Number(idText),exp=Number(expText);if(!Number.isInteger(id)||!Number.isFinite(exp)||exp<=Date.now()/1000)return null;const u=await db.prepare("SELECT id,email,password_hash FROM users WHERE id=? LIMIT 1").bind(id).first();if(!u?.password_hash)return null;return await sha(`${b64(p[0])}.${u.password_hash}`)===p[1]?u:null}catch{return null}}

const VIDEO_FIELDS=["full_video_status","short_ex_status","short_top_status","style_ex_status","style_top_status"];
const FIELD_LABELS={full_video_status:"Full Video",short_ex_status:"Short Ex",short_top_status:"Short Top",style_ex_status:"Style Ex",style_top_status:"Style Top"};
const normalize=v=>String(v??"").normalize("NFKC").toLowerCase().replace(/[।?？!！,，:：;；|]/g," ").replace(/\s+/g," ").trim();
const channelOf=x=>String(x?.channel||"").trim().toUpperCase();
const nameOf=x=>String(x?.name||x?.project_name||x?.project||x?.title||"Untitled");
const statusOf=x=>String(x?.status||"").trim().toLowerCase();
const fieldStatus=x=>VIDEO_FIELDS.map(k=>String(x?.[k]??"").trim().toLowerCase());
const statusMatches=(v,stage)=>{const s=String(v||"").toLowerCase();if(stage==="Listed")return s===""||s==="not set";if(stage==="Recorder")return s==="record";if(stage==="Editing Done")return s==="editing done"||s==="edited"||s==="edit done"||s.includes("editing done");if(stage==="Uploaded")return s.includes("upload");return false};
const isCount=q=>/how\s*many|how\s*much|count|total|number|কত|কয়|কয়|কয়টি|কয়টি|কয়টা|কয়টা|সংখ্যা|মোট/.test(normalize(q));
const wantsList=q=>/show|list|which|what|give|name|names|বল|নাম|দেখাও|লিস্ট|তালিকা|কি\s*কি|কী\s*কী|কোন\s*কোন|কোনগুলো|কোন গুলো|কোনটা|কোনটি/.test(normalize(q));
const getChannel=q=>{const l=normalize(q);const m=l.match(/(?:^|[^a-z])(hhd|bhd|dhd)(?:$|[^a-z])/i);return m?m[1].toUpperCase():null};
const isListedVideo=x=>fieldStatus(x).every(v=>v===""||v==="not set");
const isRecorderVideo=x=>fieldStatus(x).every(v=>v==="record");
const isRunningVideo=x=>!isListedVideo(x)&&!isRecorderVideo(x)&&fieldStatus(x).some(Boolean);
const stageOf=x=>isListedVideo(x)?"Listed":isRecorderVideo(x)?"Recorder":"Running";
const isEditingDone=x=>fieldStatus(x).some(v=>statusMatches(v,"Editing Done"));

function requestedFields(q){
  const l=normalize(q),out=[];
  const tests=[
    ["full_video_status",/full\s*video|fullvideo|ফুল\s*ভিডিও/],
    ["short_ex_status",/short\s*ex|shortex|শর্ট\s*ex|শর্ট\s*এক্স/],
    ["short_top_status",/short\s*top|shorttop|শর্ট\s*টপ/],
    ["style_ex_status",/style\s*ex|styleex|স্টাইল\s*ex|স্টাইল\s*এক্স/],
    ["style_top_status",/style\s*top|styletop|স্টাইল\s*টপ/]
  ];
  for(const [key,re] of tests)if(re.test(l))out.push(key);
  return out;
}

function parseDhakaDate(value){
  if(!value)return null;
  const s=String(value).trim();if(!s)return null;
  if(/Z$|[+-]\d\d:?\d\d$/.test(s)){const ms=Date.parse(s);return Number.isNaN(ms)?null:new Date(ms)}
  const m=s.replace("T"," ").match(/^(\d{4})-(\d{2})-(\d{2})[ ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if(m){const [,y,mo,d,h,mi,se="00"]=m;return new Date(Date.UTC(+y,+mo-1,+d,+h-6,+mi,+se))}
  const d=new Date(s);return Number.isNaN(d.getTime())?null:d;
}
function dhakaKey(v){const d=parseDhakaDate(v);return d?new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Dhaka",year:"numeric",month:"2-digit",day:"2-digit"}).format(d):null}
function dhakaDateTime(v){const d=parseDhakaDate(v);if(!d)return String(v||"");return new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Dhaka",day:"2-digit",month:"short",year:"numeric",hour:"numeric",minute:"2-digit",hour12:true}).format(d)}
function todayKey(offset=0){const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Dhaka",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const y=+p.find(x=>x.type==="year").value,m=+p.find(x=>x.type==="month").value,d=+p.find(x=>x.type==="day").value;return new Date(Date.UTC(y,m-1,d+offset)).toISOString().slice(0,10)}

function historyUsers(history){return (Array.isArray(history)?history:[]).filter(x=>String(x?.role||"")==="user").map(x=>String(x?.text||""));}
function isFollowupQuestion(q){
  const l=normalize(q);if(!l)return false;
  return /^(নাম|নামগুলো|নাম বল|নাম বলো|কি কি|কী কী|কী কি|কোনগুলো|কোন গুলো|কোন কোন|কোনটা|কোনটি|which|what|which ones|list|list them|show|show me|give me the list|details|বিস্তারিত|আর কি|আর কী|আরও|এগুলো|ওগুলো)$/.test(l)||/^(নাম|কি কি|কী কী|কোনগুলো|কোন গুলো|কোনটা|কোনটি|which|list|details|বিস্তারিত)\s*(বল|দাও|দেখাও)?$/.test(l);
}
function previousRelevantUser(history){const a=historyUsers(history).map(normalize).filter(Boolean);for(let i=a.length-1;i>=0;i--)if(!isFollowupQuestion(a[i]))return a[i];return a[a.length-1]||""}
function followupKind(q,history){
  if(!isFollowupQuestion(q))return null;
  const prev=previousRelevantUser(history);if(!prev)return "general";
  if(/edit|editing|edited|এডিট|এডিটিং|এডিট করা/.test(prev))return "editing";
  if(/record|recorded|recorder|রেকর্ড|রেকর্ডেড|রেকর্ডার|রেকর্ড করা/.test(prev))return "recorded";
  if(/running|in\s*progress|working|রানিং|চলছে/.test(prev))return "running";
  if(/listed|not\s*set|ready|লিস্টেড|তালিকাভুক্ত/.test(prev))return "listed";
  if(/schedule|scheduled|calendar|শিডিউল|ক্যালেন্ডার|কবে|কখন/.test(prev))return "scheduled";
  if(/post|posted|upload|আপলোড|পোস্ট/.test(prev))return "posts";
  return "general";
}
function inheritedChannel(q,history){return getChannel(q)||getChannel(previousRelevantUser(history))||null}
function inheritedFields(q,history){const f=requestedFields(q);return f.length?f:requestedFields(previousRelevantUser(history));}

function stageFromText(l,follow){
  if(/listed|not\s*set|ready|লিস্টেড|তালিকাভুক্ত/.test(l)||follow==="listed")return "Listed";
  if(/record|recorded|recorder|রেকর্ড|রেকর্ডেড|রেকর্ডার|রেকর্ড করা/.test(l)||follow==="recorded")return "Recorder";
  if(/running|in\s*progress|working|রানিং|চলছে/.test(l)||follow==="running")return "Running";
  if(/edit|editing|edited|এডিট|এডিটিং|এডিট করা/.test(l)||follow==="editing")return "Editing Done";
  if(/uploaded|upload|আপলোড/.test(l))return "Uploaded";
  return null;
}

function fieldAnswer(q,contents,history){
  const l=normalize(q),fields=inheritedFields(q,history);if(!fields.length)return null;
  const channel=inheritedChannel(q,history),follow=followupKind(q,history),stage=stageFromText(l,follow);
  const rows=contents.filter(x=>!channel||channelOf(x)===channel);
  const hasStage=!!stage;
  const matching=hasStage?rows.filter(x=>fields.some(k=>statusMatches(x?.[k],stage))):rows;
  const fieldText=fields.map(k=>FIELD_LABELS[k]).join(" / ");
  if(hasStage){
    if(isCount(l)&&!wantsList(l))return `${channel?channel+" ":""}${fieldText} — ${stage}: ${matching.length}`;
    return `${channel?channel+" ":""}${fieldText} — ${stage}: ${matching.length}\n\n${matching.length?matching.map((x,i)=>`${i+1}. ${nameOf(x)} — ${fields.map(k=>`${FIELD_LABELS[k]}: ${x?.[k]||"Not set"}`).join(" | ")}`).join("\n"):"No matching videos found."}`;
  }
  const lines=fields.map(k=>{const c=rows.filter(x=>{const v=String(x?.[k]??"").trim().toLowerCase();return v!==""&&v!=="not set"}).length;return `${FIELD_LABELS[k]}: ${c}`});
  return `${channel?channel+" ":""}${fieldText}\n${lines.join("\n")}`;
}

function videoAnswer(q,contents,history){
  const l=normalize(q),follow=followupKind(q,history),channel=inheritedChannel(q,history);
  const asksVideo=/video|content|ভিডিও|কনটেন্ট/.test(l)||!!follow;if(!asksVideo)return null;
  let stage=stageFromText(l,follow);
  const rows=contents.filter(x=>!channel||channelOf(x)===channel);
  if(stage){
    const matching=stage==="Editing Done"?rows.filter(isEditingDone):stage==="Running"?rows.filter(isRunningVideo):stage==="Listed"?rows.filter(isListedVideo):stage==="Recorder"?rows.filter(isRecorderVideo):rows.filter(x=>fieldStatus(x).some(v=>statusMatches(v,"Uploaded")));
    if(isCount(l)&&!wantsList(l))return `${channel?channel+" ":""}${stage} Videos: ${matching.length}`;
    return `${channel?channel+" ":""}${stage} Videos: ${matching.length}\n\n${matching.length?matching.map((x,i)=>`${i+1}. ${nameOf(x)}`).join("\n"):"No matching videos found."}`;
  }
  if(isCount(l)&&!wantsList(l))return `${channel?channel+" ":""}Total Content: ${rows.length}`;
  if(wantsList(l)||follow)return `${channel?channel+" ":""}Content: ${rows.length}\n\n${rows.length?rows.map((x,i)=>`${i+1}. ${nameOf(x)} — ${stageOf(x)}`).join("\n"):"No content found."}`;
  return null;
}

function scheduleAnswer(q,posts,history){
  const l=normalize(q),follow=followupKind(q,history);if(follow!=="scheduled"&&!/schedule|scheduled|calendar|শিডিউল|ক্যালেন্ডার|কবে|কখন|তারিখ|সময়|সময়|today|tomorrow|আজ|আজকে|আগামীকাল/.test(l))return null;
  const ch=inheritedChannel(q,history),all=posts.filter(p=>statusOf(p)==="scheduled"&&p?.scheduled_at&&(!ch||channelOf(p)===ch));
  const today=/\btoday\b|আজ|আজকে/.test(l),tomorrow=/\btomorrow\b|আগামীকাল/.test(l),when=/when|date|time|কবে|কখন|তারিখ|সময়|সময়/.test(l);
  const list=(today||tomorrow)?all.filter(p=>dhakaKey(p.scheduled_at)===todayKey(tomorrow?1:0)):all;
  if(today||tomorrow||when||wantsList(l)||follow==="scheduled")return `${ch?ch+" ":""}${tomorrow?"Tomorrow ":today?"Today ":""}Scheduled Posts: ${list.length}\n\n${list.length?list.map((p,i)=>`${i+1}. ${p.project_name||p.name||"Untitled"}${p.channel?` [${p.channel}]`:""} — ${dhakaDateTime(p.scheduled_at)}${p.content_type?` — ${p.content_type}`:""}${p.platform?` — ${p.platform}`:""}`).join("\n"):"No scheduled posts found."}`;
  return `${ch?ch+" ":""}Total Scheduled Posts: ${all.length}`;
}

function postAnswer(q,posts,history){
  const l=normalize(q),follow=followupKind(q,history);if(follow!=="posts"&&!/post|posted|uploaded|upload|link|পোস্ট|আপলোড|লিংক|স্ট্যাটাস|status/.test(l))return null;
  const ch=inheritedChannel(q,history),rows=posts.filter(p=>!ch||channelOf(p)===ch);
  if(/uploaded|upload|আপলোড/.test(l)){const a=rows.filter(p=>/uploaded|upload/.test(statusOf(p)));return `${ch?ch+" ":""}Uploaded Posts: ${a.length}${wantsList(l)?`\n\n${a.map((p,i)=>`${i+1}. ${p.project_name||p.name||"Untitled"}`).join("\n")}`:""}`}
  if(/status|স্ট্যাটাস/.test(l)&&wantsList(l))return rows.length?rows.map((p,i)=>`${i+1}. ${p.project_name||p.name||"Untitled"} — ${p.status||"Not set"}`).join("\n"):"No posts found.";
  if(isCount(l)&&!wantsList(l))return `${ch?ch+" ":""}Total Posts: ${rows.length}`;
  return `${ch?ch+" ":""}Posts: ${rows.length}\n\n${rows.slice(0,200).map((p,i)=>`${i+1}. ${p.project_name||p.name||"Untitled"} — ${p.status||"Not set"}`).join("\n")}`;
}

function buildSummary(contents,posts){
  const channelSummary=Object.fromEntries(["HHD","BHD","DHD"].map(c=>{const a=contents.filter(x=>channelOf(x)===c);return[c,{total:a.length,listed:a.filter(isListedVideo).length,recorder:a.filter(isRecorderVideo).length,running:a.filter(isRunningVideo).length,editing_done:a.filter(isEditingDone).length}]}));
  const scheduled=posts.filter(p=>statusOf(p)==="scheduled"&&p.scheduled_at);
  return{channels:channelSummary,total_contents:contents.length,total_posts:posts.length,total_scheduled:scheduled.length,scheduled_today:scheduled.filter(p=>dhakaKey(p.scheduled_at)===todayKey()).length,scheduled_tomorrow:scheduled.filter(p=>dhakaKey(p.scheduled_at)===todayKey(1)).length,content_types:[...new Set(posts.map(p=>p.content_type).filter(Boolean))],platforms:[...new Set(posts.map(p=>p.platform).filter(Boolean))]}
}

const SENSITIVE_KEYS=/password|password_hash|token|secret|api[_-]?key|authorization|cookie/i;
function sanitizeRow(row){const out={};for(const [k,v] of Object.entries(row||{})){if(!SENSITIVE_KEYS.test(k))out[k]=v}return out}
function quoteIdent(name){return `"${String(name).replaceAll('"','""')}"`}

async function loadAllData(db){
  const tableResult=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const tables=(tableResult.results||[]).map(x=>String(x.name||"")).filter(Boolean);
  const data={};
  for(const table of tables){
    if(table==="users"){
      const r=await db.prepare("SELECT id,email FROM users ORDER BY id DESC LIMIT 1000").all();
      data[table]=(r.results||[]).map(sanitizeRow);continue;
    }
    try{const r=await db.prepare(`SELECT * FROM ${quoteIdent(table)} LIMIT 5000`).all();data[table]=(r.results||[]).map(sanitizeRow)}catch{data[table]=[]}
  }
  return data;
}

function text(r){return(r?.output||[]).flatMap(x=>x?.content||[]).filter(x=>x?.type==="output_text").map(x=>x.text).join("\n").trim()}

export async function handleChat(request,env){
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  if(request.method!=="POST")return json({error:"method not allowed"},405);
  if(!env?.DB)return json({error:"D1 binding DB is not configured"},500);
  if(!await auth(request,env.DB))return json({error:"authentication required"},401);
  const body=await request.json().catch(()=>({}));
  const q=String(body.message||"").trim();
  const history=Array.isArray(body.history)?body.history.slice(-30):[];
  if(!q)return json({error:"message required"},400);
  if(q.length>3000)return json({error:"message is too long"},400);
  let allData={};
  try{allData=await loadAllData(env.DB)}catch(e){return json({error:`database read failed: ${e?.message||e}`},500)}
  const contents=Array.isArray(allData.contents)?allData.contents:[];
  const posts=Array.isArray(allData.posts)?allData.posts:[];

  // Deterministic live-data answers run first. This prevents the model from
  // returning "not found" when the requested concept exists in the database.
  const direct=fieldAnswer(q,contents,history)||videoAnswer(q,contents,history)||scheduleAnswer(q,posts,history)||postAnswer(q,posts,history);
  if(direct)return json({answer:direct});

  const key=String(env.OPENAI_API_KEY||"").trim();
  if(!key)return json({answer:"প্রশ্নটি বুঝতে পারিনি। Content, video, recording, editing, schedule, post, channel, status, date, time, client, book বা app-এর data সম্পর্কে প্রশ্ন করুন।"});
  const summary=buildSummary(contents,posts);
  const previous=history.filter(x=>x?.role&&x?.text).map(x=>`${x.role}: ${x.text}`).join("\n");
  const ctx={summary,tables:Object.keys(allData),data:allData};
  const instructions=`You are the private live-data assistant for a Content Schedule Manager.

CORE RULES:
1. Use ONLY the LIVE DATABASE DATA supplied in this request. Never invent, guess, estimate, or use stale information.
2. You have access to every non-sensitive table currently present in the app. Answer from any table when the user asks about clients, books, contents, posts, schedules, status, channels, projects, dates, times, links, or other app data.
3. Understand Bangla, Banglish, and English. Treat equivalent wording as the same intent. Examples: "রেকর্ড করা", "রেকর্ডেড", "recorder", "record video" all refer to recording; "এডিট করা", "editing done", "edited" refer to editing; "কতটা", "কতটি", "কয়টা", "how many" ask for a count.
4. HHD, BHD and DHD are channel names. Preserve the channel filter when the user uses it.
5. A content row is a Recorder video when all five video status fields are Record.
6. A Listed video has all five video status fields empty or Not set.
7. A Running video is neither Listed nor Recorder and has at least one non-empty video status.
8. An Editing Done video has at least one video status containing Editing Done, Edited, or Edit Done.
9. If the user mentions a specific field such as Full Video, Short Ex, Short Top, Style Ex, or Style Top, answer using that exact field. If two fields are mentioned with "or", compare/list both fields instead of saying not found.
10. Scheduled posts have status Scheduled and scheduled_at present. Interpret dates/times in Asia/Dhaka.
11. Follow-up questions inherit the latest relevant user context, including channel, stage, date, time, and field. Example: "HHD-তে editing done কয়টা?" then "নামগুলো বল" means list HHD editing-done names.
12. If a question asks for a count, give the exact count. If it asks for names/details, list the matching records.
13. Map natural wording to database fields semantically. Do NOT reply "not found" merely because the exact wording is absent.
14. Only say data is unavailable when the requested information truly does not exist in the supplied live data or the relevant field/table is absent.
15. Never expose passwords, password hashes, API keys, tokens, secrets, authorization values, or other sensitive fields.
16. Be concise but complete. This is a read-only assistant.`;
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:String(env.OPENAI_MODEL||"gpt-5.6-luna"),instructions,input:`CURRENT QUESTION:\n${q}\n\nRECENT CONVERSATION:\n${previous||"none"}\n\nLIVE DATABASE DATA:\n${JSON.stringify(ctx)}`,store:false,max_output_tokens:3000})});
  const raw=await response.text();
  if(!response.ok){let e="AI request failed";try{e=JSON.parse(raw)?.error?.message||e}catch{}return json({error:e},502)}
  let parsed=null;try{parsed=JSON.parse(raw)}catch{return json({error:"invalid AI response"},502)}
  const answer=text(parsed);
  return answer?json({answer}):json({answer:"এই প্রশ্নের জন্য live data থেকে কোনো উত্তর তৈরি করা যায়নি। অন্যভাবে প্রশ্নটি লিখে চেষ্টা করুন।"});
}
