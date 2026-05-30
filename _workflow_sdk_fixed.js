import { workflow, node, trigger, newCredential } from '@n8n/workflow-sdk';

const inboxCode = `
const decodeWord=(str)=>{if(!str||typeof str!=="string")return str||"";return str.replace(/=\\?([^?]+)\\?([BbQq])\\?([^?]*)\\?=/g,(_,charset,enc,text)=>{try{const buf=enc.toUpperCase()==="B"?Buffer.from(text,"base64"):Buffer.from(text.replace(/_/g," ").replace(/=([0-9A-Fa-f]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))),"binary");try{return new TextDecoder(charset).decode(buf);}catch{return buf.toString("utf8");}}catch{return text;}});};
const fixMojibake=(str)=>{if(!str||typeof str!=="string")return str;if(!/[\\xC0-\\xFF]/.test(str))return str;try{const bytes=Buffer.from(str,"latin1");const decoded=new TextDecoder("utf-8").decode(bytes);if(/[　-鿿゠-ヿ぀-ゟ가-힯]/.test(decoded)&&!/[　-鿿]/.test(str))return decoded;}catch{}return str;};
const pa=(s)=>{if(!s)return{n:"不明",a:""};const fixed=fixMojibake(decodeWord(s));const m=fixed.match(/^(.+?)\\s*<([^>]+)>/);return m?{n:m[1].trim()||m[2],a:m[2].trim()}:{n:fixed,a:fixed};};
const getBody=(item)=>{let txt=item.textPlain||item.text||"";if(txt&&(txt.includes("\\x1b")||/\\$B|\\(B/.test(txt))){try{txt=new TextDecoder("iso-2022-jp").decode(Buffer.from(txt,"latin1"));}catch{txt=txt.replace(/\\x1b\\$[B@J]/g,"").replace(/\\x1b\\([BHJ]/g,"").trim();}}txt=fixMojibake(txt);if(txt.trim())return txt.substring(0,3000);const html=fixMojibake(item.textHtml||item.html||"");return html.replace(/<style[\\s\\S]*?<\\/style>/gi,"").replace(/<script[\\s\\S]*?<\\/script>/gi,"").replace(/<br\\s*\\/?>/gi,"\\n").replace(/<p[^>]*>/gi,"\\n").replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/\\s+/g," ").trim().substring(0,3000);};
const getHtmlBody=(item)=>{const html=fixMojibake(item.textHtml||item.html||"");if(!html||!/<img[\\s>]/i.test(html))return "";return html.substring(0,50000);};
const MAX_IMG_SZ=1*1024*1024,MAX_IMG_N=4;
const getInlineImgs=(item,bin)=>{if(!bin)return [];const atts=Array.isArray(item.attachments)?item.attachments:[];const imgs=[];for(let i=0;i<atts.length&&imgs.length<MAX_IMG_N;i++){const a=atts[i];const mime=(a.mimeType||a.contentType||"").toLowerCase();if(!mime.startsWith("image/"))continue;const b=bin["attachment_"+i];const content=b?.data||"";if(!content)continue;const sz=b?.fileSize||a.fileSize||(content.length*3/4)|0;if(sz>MAX_IMG_SZ)continue;imgs.push({filename:a.fileName||a.filename||("image"+(i+1)),mimeType:mime,contentId:a.contentId||"",isInline:!!(a.isInline||a.contentId),size:sz,dataUrl:"data:"+mime+";base64,"+content});}return imgs;};
const sd=$getWorkflowStaticData("global");
if(!sd.inboxEmails)sd.inboxEmails={};
const results=[];
for(let idx=0;idx<items.length;idx++){
  const item=items[idx].json;
  const bin=items[idx].binary||null;
  const from=pa(item.from);const to=pa(item.to);
  const body=getBody(item);
  const htmlBody=getHtmlBody(item);
  const subj=fixMojibake(decodeWord(item.subject||"(件名なし)"));
  const mid=item.metadata?.["message-id"]||String(item.attributes?.uid||("recv_"+Math.random()));
  const attachments=getInlineImgs(item,bin);
  const newEntry={id:String(item.attributes?.uid||Math.random()),messageId:mid,from:from.a,fromName:from.n,to:to.a,subject:subj,body,htmlBody,snippet:body.replace(/<[^>]*>/g,"").substring(0,120),date:item.date||new Date().toISOString(),read:!!(item.attributes?.flags?.["\\\\Seen"]),isSent:false,accountId:"work",inReplyTo:item.metadata?.["in-reply-to"]||"",references:item.metadata?.["references"]||"",attachments};
  const existed=!!sd.inboxEmails[mid];
  if(!existed){sd.inboxEmails[mid]=newEntry;}else{if(htmlBody)sd.inboxEmails[mid].htmlBody=htmlBody;if(attachments.length)sd.inboxEmails[mid].attachments=attachments;const eb=sd.inboxEmails[mid].body||"";if(body.trim()&&(!eb.trim()||/[\\xC0-\\xFF]/.test(eb))){sd.inboxEmails[mid].body=body;sd.inboxEmails[mid].snippet=newEntry.snippet;}}
  results.push({json:{saved:mid,total:Object.keys(sd.inboxEmails).length,updated:existed}});
}
const MAX=500;const ks=Object.keys(sd.inboxEmails);
if(ks.length>MAX){ks.sort((a,b)=>new Date(sd.inboxEmails[a]?.date||0)-new Date(sd.inboxEmails[b]?.date||0)).slice(0,ks.length-MAX).forEach(k=>delete sd.inboxEmails[k]);}

// sentEmails 保護: DB 最新値とマージし INBOX.Sent の書き込みを上書きしない
try{
  const _s3=require('/usr/local/lib/node_modules/n8n/node_modules/.pnpm/sqlite3@5.1.7/node_modules/sqlite3/lib/sqlite3.js');
  const _dbSent=await new Promise(res=>{
    const _db=new _s3.Database('/home/node/.n8n/database.sqlite',_s3.OPEN_READONLY,(e)=>{if(e){res({});return;}
      _db.get("SELECT staticData FROM workflow_entity WHERE id='sRUVnMcEkIYzmbCJ'",(e2,row)=>{
        _db.close();
        if(e2||!row||!row.staticData){res({});return;}
        try{const f=JSON.parse(row.staticData);res((f.global||f).sentEmails||{});}catch{res({});}
      });
    });
  });
  if(_dbSent&&Object.keys(_dbSent).length>0)sd.sentEmails={...(sd.sentEmails||{}),..._dbSent};
}catch(_e){}

return results;
`;

const sentCode = `
const decodeWord=(str)=>{if(!str||typeof str!=="string")return str||"";return str.replace(/=\\?([^?]+)\\?([BbQq])\\?([^?]*)\\?=/g,(_,charset,enc,text)=>{try{const buf=enc.toUpperCase()==="B"?Buffer.from(text,"base64"):Buffer.from(text.replace(/_/g," ").replace(/=([0-9A-Fa-f]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))),"binary");try{return new TextDecoder(charset).decode(buf);}catch{return buf.toString("utf8");}}catch{return text;}});};
const fixMojibake=(str)=>{if(!str||typeof str!=="string")return str;if(!/[\\xC0-\\xFF]/.test(str))return str;try{const bytes=Buffer.from(str,"latin1");const decoded=new TextDecoder("utf-8").decode(bytes);if(/[　-鿿゠-ヿ぀-ゟ가-힯]/.test(decoded)&&!/[　-鿿]/.test(str))return decoded;}catch{}return str;};
const pa=(s)=>{if(!s)return{n:"不明",a:""};const fixed=fixMojibake(decodeWord(s));const m=fixed.match(/^(.+?)\\s*<([^>]+)>/);return m?{n:m[1].trim()||m[2],a:m[2].trim()}:{n:fixed,a:fixed};};
const getBody=(item)=>{let txt=item.textPlain||item.text||"";if(txt&&(txt.includes("\\x1b")||/\\$B|\\(B/.test(txt))){try{txt=new TextDecoder("iso-2022-jp").decode(Buffer.from(txt,"latin1"));}catch{txt=txt.replace(/\\x1b\\$[B@J]/g,"").replace(/\\x1b\\([BHJ]/g,"").trim();}}txt=fixMojibake(txt);if(txt.trim())return txt.substring(0,3000);const html=fixMojibake(item.textHtml||item.html||"");return html.replace(/<style[\\s\\S]*?<\\/style>/gi,"").replace(/<script[\\s\\S]*?<\\/script>/gi,"").replace(/<br\\s*\\/?>/gi,"\\n").replace(/<p[^>]*>/gi,"\\n").replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/\\s+/g," ").trim().substring(0,3000);};
const getHtmlBody=(item)=>{const html=fixMojibake(item.textHtml||item.html||"");if(!html||!/<img[\\s>]/i.test(html))return "";return html.substring(0,50000);};
const sd=$getWorkflowStaticData("global");
if(!sd.sentEmails)sd.sentEmails={};
const results=[];
for(let idx=0;idx<items.length;idx++){
  const item=items[idx].json;
  const from=pa(item.from);const to=pa(item.to);
  const body=getBody(item);
  const htmlBody=getHtmlBody(item);
  const subj=fixMojibake(decodeWord(item.subject||"(件名なし)"));
  const mid=item.metadata?.["message-id"]||String(item.attributes?.uid||("sent_"+Math.random()));
  const newEntry={id:String(item.attributes?.uid||Math.random()),messageId:mid,from:from.a,fromName:from.n,to:to.a,subject:subj,body,htmlBody,snippet:body.replace(/<[^>]*>/g,"").substring(0,120),date:item.date||new Date().toISOString(),read:true,isSent:true,accountId:"work",inReplyTo:item.metadata?.["in-reply-to"]||"",references:item.metadata?.["references"]||"",attachments:[]};
  const existed=!!sd.sentEmails[mid];
  if(!existed){
    // IMAP取得の実際のMessageIDが届いたとき、同じメールのfake mailchat IDを削除（重複排除）
    const subjBase=subj.replace(/^(Re|Fwd|Fw|RE|FWD|FW):\\s*/gi,"").trim();
    const fakeKey=Object.keys(sd.sentEmails).find(k=>{
      if(!k.includes("@mailchat"))return false;
      const e=sd.sentEmails[k];
      if((e.to||"").toLowerCase()!==(to.a||"").toLowerCase())return false;
      const eSub=(e.subject||"").replace(/^(Re|Fwd|Fw|RE|FWD|FW):\\s*/gi,"").trim();
      if(eSub!==subjBase)return false;
      return Math.abs(new Date(e.date)-new Date(newEntry.date))<60*60*1000;
    });
    if(fakeKey)delete sd.sentEmails[fakeKey];
    sd.sentEmails[mid]=newEntry;
  }else{
    if(htmlBody)sd.sentEmails[mid].htmlBody=htmlBody;
    const eb=sd.sentEmails[mid].body||"";
    if(body.trim()&&(!eb.trim()||/[\\xC0-\\xFF]/.test(eb))){sd.sentEmails[mid].body=body;sd.sentEmails[mid].snippet=newEntry.snippet;}
  }
  results.push({json:{saved:mid,total:Object.keys(sd.sentEmails).length,updated:existed}});
}
const MAX=500;const ks=Object.keys(sd.sentEmails);
if(ks.length>MAX){ks.sort((a,b)=>new Date(sd.sentEmails[a]?.date||0)-new Date(sd.sentEmails[b]?.date||0)).slice(0,ks.length-MAX).forEach(k=>delete sd.sentEmails[k]);}
return results;
`;

const getEmailsCode = `
const fixMojibake=(str)=>{if(!str||typeof str!=="string")return str;if(!/[\\xC0-\\xFF]/.test(str))return str;try{const bytes=Buffer.from(str,"latin1");const decoded=new TextDecoder("utf-8").decode(bytes);if(/[　-鿿゠-ヿ぀-ゟ가-힯]/.test(decoded)&&!/[　-鿿]/.test(str))return decoded;}catch{}return str;};
const fixEmail=(e)=>({...e,subject:fixMojibake(e.subject||""),body:fixMojibake(e.body||""),snippet:fixMojibake(e.snippet||""),fromName:fixMojibake(e.fromName||""),to:fixMojibake(e.to||""),});
const sd=$getWorkflowStaticData("global");
const since=$json?.query?.since||"";
const sinceDate=since?new Date(since):null;
const all=[...Object.values(sd.inboxEmails||{}),...Object.values(sd.sentEmails||{}),...Object.values(sd.emails||{})].map(fixEmail).filter(e=>!sinceDate||new Date(e.date)>sinceDate);
all.sort((a,b)=>new Date(b.date)-new Date(a.date));
return [{json:{emails:all,total:all.length,fetchedAt:new Date().toISOString()}}];
`;

const bulkSaveCode = `
const sd=$getWorkflowStaticData("global");
if(!sd.inboxEmails)sd.inboxEmails={};
if(!sd.sentEmails)sd.sentEmails={};
const incoming=$json.body?.emails||[];
let added=0,updated=0;
for(const m of incoming){
  if(!m.messageId)continue;
  const store=m.isSent?sd.sentEmails:sd.inboxEmails;
  if(!store[m.messageId]){store[m.messageId]=m;added++;}
  else{const ex=store[m.messageId];store[m.messageId]={...ex,body:m.body||ex.body,htmlBody:m.htmlBody||ex.htmlBody||"",snippet:m.snippet||ex.snippet,attachments:m.attachments||ex.attachments||[],inReplyTo:m.inReplyTo||ex.inReplyTo||"",references:m.references||ex.references||""};updated++;}
}
const total=Object.keys(sd.inboxEmails).length+Object.keys(sd.sentEmails).length;
return [{json:{ok:true,added,updated,total}}];
`;

const imapInbox = trigger({
  type: 'n8n-nodes-base.emailReadImap',
  version: 2.1,
  config: {
    name: 'IMAP - INBOX',
    parameters: {
      mailbox: 'INBOX',
      postProcessAction: 'nothing',
      downloadAttachments: true,
      options: { customEmailConfig: '["ALL"]', forceReconnect: 60, trackLastMessageId: true },
    },
    credentials: { imap: newCredential('IMAP account') },
  },
});

const imapSent = trigger({
  type: 'n8n-nodes-base.emailReadImap',
  version: 2.1,
  config: {
    name: 'IMAP - INBOX.Sent',
    parameters: {
      mailbox: 'INBOX.Sent',
      postProcessAction: 'nothing',
      downloadAttachments: false,
      options: { customEmailConfig: '["ALL"]', forceReconnect: 60, trackLastMessageId: false },
    },
    credentials: { imap: newCredential('IMAP account') },
  },
});

const saveInbox = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: '受信を保存', parameters: { mode: 'runOnceForAllItems', jsCode: inboxCode } },
});

const saveSent = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: '送信を保存', parameters: { mode: 'runOnceForAllItems', jsCode: sentCode } },
});

const webhookGet = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook - メール取得',
    parameters: { httpMethod: 'GET', path: 'fetch-emails', responseMode: 'responseNode', options: {} },
  },
});

const getEmails = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'メールを返す', parameters: { mode: 'runOnceForAllItems', jsCode: getEmailsCode } },
});

const respond = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'レスポンス',
    parameters: {
      respondWith: 'json',
      responseBody: '={{ $json }}',
      options: { responseHeaders: { entries: [
        { name: 'Access-Control-Allow-Origin',  value: '*' },
        { name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
        { name: 'Access-Control-Allow-Headers', value: 'Content-Type' },
      ] } },
    },
  },
});

const webhookImport = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook - 一括インポート',
    parameters: { httpMethod: 'POST', path: 'import-emails', responseMode: 'responseNode', options: {} },
  },
});

const bulkSave = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: '一括保存', parameters: { mode: 'runOnceForAllItems', jsCode: bulkSaveCode } },
});

const importDone = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'インポート完了',
    parameters: {
      respondWith: 'json',
      responseBody: '={{ $json }}',
      options: { responseHeaders: { entries: [{ name: 'Access-Control-Allow-Origin', value: '*' }] } },
    },
  },
});

export default workflow('sRUVnMcEkIYzmbCJ', 'MailChat - メール取得')
  .add(imapInbox).to(saveInbox)
  .add(imapSent).to(saveSent)
  .add(webhookGet).to(getEmails).to(respond)
  .add(webhookImport).to(bulkSave).to(importDone);
