import { workflow, node, trigger, newCredential } from '@n8n/workflow-sdk';

const inboxCode = `
const decodeWord=(str)=>{if(!str||typeof str!=="string")return str||"";return str.replace(/=\\?([^?]+)\\?([BbQq])\\?([^?]*)\\?=/g,(_,charset,enc,text)=>{try{const buf=enc.toUpperCase()==="B"?Buffer.from(text,"base64"):Buffer.from(text.replace(/_/g," ").replace(/=([0-9A-Fa-f]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))),"binary");try{return new TextDecoder(charset).decode(buf);}catch{return buf.toString("utf8");}}catch{return text;}});};
const fixMojibake=(str)=>{if(!str||typeof str!=="string")return str;if(!/[\\xC0-\\xFF]/.test(str))return str;try{const bytes=Buffer.from(str,"latin1");const decoded=new TextDecoder("utf-8").decode(bytes);if(/[　-鿿゠-ヿ぀-ゟ가-힯]/.test(decoded)&&!/[　-鿿]/.test(str))return decoded;}catch{}return str;};
const pa=(s)=>{if(!s)return{n:"不明",a:""};const fixed=fixMojibake(decodeWord(s));const m=fixed.match(/^(.+?)\\s*<([^>]+)>/);return m?{n:m[1].trim()||m[2],a:m[2].trim()}:{n:fixed,a:fixed};};
const getBody=(item)=>{let txt=item.textPlain||item.text||"";if(txt&&(txt.includes("\\x1b")||/\\$B|\\(B/.test(txt))){try{txt=new TextDecoder("iso-2022-jp").decode(Buffer.from(txt,"latin1"));}catch{txt=txt.replace(/\\x1b\\$[B@J]/g,"").replace(/\\x1b\\([BHJ]/g,"").trim();}}txt=fixMojibake(txt);if(txt.trim())return txt.substring(0,3000);const html=fixMojibake(item.textHtml||item.html||"");return html.replace(/<style[\\s\\S]*?<\\/style>/gi,"").replace(/<script[\\s\\S]*?<\\/script>/gi,"").replace(/<br\\s*\\/?>/gi,"\\n").replace(/<p[^>]*>/gi,"\\n").replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/\\s+/g," ").trim().substring(0,3000);};
// HTMLメール本文（CID参照を含む場合に保存）
const getHtmlBody=(item)=>{const html=fixMojibake(item.textHtml||item.html||"");if(!html||!html.includes("cid:"))return "";return html.substring(0,50000);};
const getAttachments=(item,bin)=>{
  const jsonAtts=item.attachments||[];
  const binEntries=bin?Object.entries(bin).filter(([k])=>/^attachment/i.test(k)):[];
  let merged;
  if(jsonAtts.length>0){
    merged=jsonAtts.map((a,i)=>{
      const bk="attachment_"+i;
      const bv=bin&&(bin[bk]||(binEntries[i]?binEntries[i][1]:null));
      return {...a,content:a.content||(bv?bv.data:"")||""};
    });
  }else{
    merged=binEntries.map(([k,v])=>({
      filename:v.fileName||v.filename||k,
      mimeType:v.mimeType||"application/octet-stream",
      size:v.fileSize||0,
      content:v.data||"",
      contentDisposition:"attachment",
    }));
  }
  return merged.filter(a=>a&&(a.filename||a.name||(a.mimeType&&a.mimeType.startsWith("image/"))||(a.contentType&&a.contentType.startsWith("image/")))).map(a=>{
    const mime=a.mimeType||a.contentType||a.type||"application/octet-stream";
    const sz=typeof a.size==="number"?a.size:typeof a.content==="string"&&a.content?Buffer.from(a.content,"base64").length:0;
    const dataUrl=(typeof a.content==="string"&&a.content&&sz<=5*1024*1024)?("data:"+(mime||"application/octet-stream")+";base64,"+a.content):undefined;
    // contentId を保持（CID参照によるインライン画像置換のため）
    const contentId=a.contentId||a.cid||"";
    return{filename:fixMojibake(decodeWord(a.filename||a.name||(mime.startsWith("image/")?"image."+((mime).split("/")[1]||"jpg"):"attachment"))),mimeType:mime,size:sz,isInline:a.contentDisposition==="inline"||!!a.contentId,contentId,dataUrl};
  });
};
const sd=$getWorkflowStaticData("global");
if(!sd.emails)sd.emails={};
const results=[];
for(let idx=0;idx<items.length;idx++){
  const item=items[idx].json;
  const bin=items[idx].binary||null;
  const from=pa(item.from);const to=pa(item.to);
  const body=getBody(item);
  const htmlBody=getHtmlBody(item);
  const subj=fixMojibake(decodeWord(item.subject||"(件名なし)"));
  const mid=item.metadata?.["message-id"]||String(item.attributes?.uid||("recv_"+Math.random()));
  const atts=getAttachments(item,bin);
  const newEntry={id:String(item.attributes?.uid||Math.random()),messageId:mid,from:from.a,fromName:from.n,to:to.a,subject:subj,body,htmlBody,snippet:body.replace(/<[^>]*>/g,"").substring(0,120),date:item.date||new Date().toISOString(),read:!!(item.attributes?.flags?.["\\\\Seen"]),isSent:false,accountId:"work",inReplyTo:item.metadata?.["in-reply-to"]||"",references:item.metadata?.["references"]||"",attachments:atts};
  const existed=!!sd.emails[mid];
  if(!existed){sd.emails[mid]=newEntry;}else{if(atts.length>0)sd.emails[mid].attachments=atts;if(htmlBody)sd.emails[mid].htmlBody=htmlBody;const eb=sd.emails[mid].body||"";if(body.trim()&&(!eb.trim()||/[\\xC0-\\xFF]/.test(eb))){sd.emails[mid].body=body;sd.emails[mid].snippet=newEntry.snippet;}}
  results.push({json:{saved:mid,total:Object.keys(sd.emails).length,attachments:atts.length,updated:existed}});
}
return results;
`;

const sentCode = `
const decodeWord=(str)=>{if(!str||typeof str!=="string")return str||"";return str.replace(/=\\?([^?]+)\\?([BbQq])\\?([^?]*)\\?=/g,(_,charset,enc,text)=>{try{const buf=enc.toUpperCase()==="B"?Buffer.from(text,"base64"):Buffer.from(text.replace(/_/g," ").replace(/=([0-9A-Fa-f]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))),"binary");try{return new TextDecoder(charset).decode(buf);}catch{return buf.toString("utf8");}}catch{return text;}});};
const fixMojibake=(str)=>{if(!str||typeof str!=="string")return str;if(!/[\\xC0-\\xFF]/.test(str))return str;try{const bytes=Buffer.from(str,"latin1");const decoded=new TextDecoder("utf-8").decode(bytes);if(/[　-鿿゠-ヿ぀-ゟ가-힯]/.test(decoded)&&!/[　-鿿]/.test(str))return decoded;}catch{}return str;};
const pa=(s)=>{if(!s)return{n:"不明",a:""};const fixed=fixMojibake(decodeWord(s));const m=fixed.match(/^(.+?)\\s*<([^>]+)>/);return m?{n:m[1].trim()||m[2],a:m[2].trim()}:{n:fixed,a:fixed};};
const getBody=(item)=>{let txt=item.textPlain||item.text||"";if(txt&&(txt.includes("\\x1b")||/\\$B|\\(B/.test(txt))){try{txt=new TextDecoder("iso-2022-jp").decode(Buffer.from(txt,"latin1"));}catch{txt=txt.replace(/\\x1b\\$[B@J]/g,"").replace(/\\x1b\\([BHJ]/g,"").trim();}}txt=fixMojibake(txt);if(txt.trim())return txt.substring(0,3000);const html=fixMojibake(item.textHtml||item.html||"");return html.replace(/<style[\\s\\S]*?<\\/style>/gi,"").replace(/<script[\\s\\S]*?<\\/script>/gi,"").replace(/<br\\s*\\/?>/gi,"\\n").replace(/<p[^>]*>/gi,"\\n").replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/\\s+/g," ").trim().substring(0,3000);};
// HTMLメール本文（CID参照を含む場合に保存）
const getHtmlBody=(item)=>{const html=fixMojibake(item.textHtml||item.html||"");if(!html||!html.includes("cid:"))return "";return html.substring(0,50000);};
const getAttachments=(item,bin)=>{
  const jsonAtts=item.attachments||[];
  const binEntries=bin?Object.entries(bin).filter(([k])=>/^attachment/i.test(k)):[];
  let merged;
  if(jsonAtts.length>0){
    merged=jsonAtts.map((a,i)=>{
      const bk="attachment_"+i;
      const bv=bin&&(bin[bk]||(binEntries[i]?binEntries[i][1]:null));
      return {...a,content:a.content||(bv?bv.data:"")||""};
    });
  }else{
    merged=binEntries.map(([k,v])=>({
      filename:v.fileName||v.filename||k,
      mimeType:v.mimeType||"application/octet-stream",
      size:v.fileSize||0,
      content:v.data||"",
      contentDisposition:"attachment",
    }));
  }
  return merged.filter(a=>a&&(a.filename||a.name||(a.mimeType&&a.mimeType.startsWith("image/"))||(a.contentType&&a.contentType.startsWith("image/")))).map(a=>{
    const mime=a.mimeType||a.contentType||a.type||"application/octet-stream";
    const sz=typeof a.size==="number"?a.size:typeof a.content==="string"&&a.content?Buffer.from(a.content,"base64").length:0;
    const dataUrl=(typeof a.content==="string"&&a.content&&sz<=5*1024*1024)?("data:"+(mime||"application/octet-stream")+";base64,"+a.content):undefined;
    // contentId を保持（CID参照によるインライン画像置換のため）
    const contentId=a.contentId||a.cid||"";
    return{filename:fixMojibake(decodeWord(a.filename||a.name||(mime.startsWith("image/")?"image."+((mime).split("/")[1]||"jpg"):"attachment"))),mimeType:mime,size:sz,isInline:a.contentDisposition==="inline"||!!a.contentId,contentId,dataUrl};
  });
};
const sd=$getWorkflowStaticData("global");
if(!sd.emails)sd.emails={};
const results=[];
for(let idx=0;idx<items.length;idx++){
  const item=items[idx].json;
  const bin=items[idx].binary||null;
  const from=pa(item.from);const to=pa(item.to);
  const body=getBody(item);
  const htmlBody=getHtmlBody(item);
  const subj=fixMojibake(decodeWord(item.subject||"(件名なし)"));
  const mid=item.metadata?.["message-id"]||String(item.attributes?.uid||("sent_"+Math.random()));
  const atts=getAttachments(item,bin);
  const newEntry={id:String(item.attributes?.uid||Math.random()),messageId:mid,from:from.a,fromName:from.n,to:to.a,subject:subj,body,htmlBody,snippet:body.replace(/<[^>]*>/g,"").substring(0,120),date:item.date||new Date().toISOString(),read:true,isSent:true,accountId:"work",inReplyTo:item.metadata?.["in-reply-to"]||"",references:item.metadata?.["references"]||"",attachments:atts};
  const existed=!!sd.emails[mid];
  if(!existed){
    // IMAP取得の実際のMessageIDが届いたとき、同じメールのfake mailchat IDを削除（重複排除）
    const subjBase=subj.replace(/^(Re|Fwd|Fw|RE|FWD|FW):\\s*/gi,"").trim();
    const fakeKey=Object.keys(sd.emails).find(k=>{
      if(!k.includes("@mailchat"))return false;
      const e=sd.emails[k];
      if((e.to||"").toLowerCase()!==(to.a||"").toLowerCase())return false;
      const eSub=(e.subject||"").replace(/^(Re|Fwd|Fw|RE|FWD|FW):\\s*/gi,"").trim();
      if(eSub!==subjBase)return false;
      return Math.abs(new Date(e.date)-new Date(newEntry.date))<60*60*1000;
    });
    if(fakeKey)delete sd.emails[fakeKey];
    sd.emails[mid]=newEntry;
  }else{
    if(atts.length>0)sd.emails[mid].attachments=atts;
    if(htmlBody)sd.emails[mid].htmlBody=htmlBody;
    const eb=sd.emails[mid].body||"";
    if(body.trim()&&(!eb.trim()||/[\\xC0-\\xFF]/.test(eb))){sd.emails[mid].body=body;sd.emails[mid].snippet=newEntry.snippet;}
  }
  results.push({json:{saved:mid,total:Object.keys(sd.emails).length,attachments:atts.length,updated:existed}});
}
return results;
`;

const getEmailsCode = `
const fixMojibake=(str)=>{if(!str||typeof str!=="string")return str;if(!/[\\xC0-\\xFF]/.test(str))return str;try{const bytes=Buffer.from(str,"latin1");const decoded=new TextDecoder("utf-8").decode(bytes);if(/[　-鿿゠-ヿ぀-ゟ가-힯]/.test(decoded)&&!/[　-鿿]/.test(str))return decoded;}catch{}return str;};
const fixEmail=(e)=>({...e,subject:fixMojibake(e.subject||""),body:fixMojibake(e.body||""),snippet:fixMojibake(e.snippet||""),fromName:fixMojibake(e.fromName||""),to:fixMojibake(e.to||""),});
const sd=$getWorkflowStaticData("global");
const all=Object.values(sd.emails||{}).map(fixEmail);
all.sort((a,b)=>new Date(b.date)-new Date(a.date));
return [{json:{emails:all,total:all.length,fetchedAt:new Date().toISOString()}}];
`;

const bulkSaveCode = `
const sd=$getWorkflowStaticData("global");
if(!sd.emails)sd.emails={};
const incoming=$json.body?.emails||[];
let added=0,updated=0;
for(const m of incoming){
  if(!m.messageId)continue;
  if(!sd.emails[m.messageId]){sd.emails[m.messageId]=m;added++;}
  else{const ex=sd.emails[m.messageId];sd.emails[m.messageId]={...ex,body:m.body||ex.body,htmlBody:m.htmlBody||ex.htmlBody||"",snippet:m.snippet||ex.snippet,attachments:m.attachments||ex.attachments||[],inReplyTo:m.inReplyTo||ex.inReplyTo||"",references:m.references||ex.references||""};updated++;}
}
return [{json:{ok:true,added,updated,total:Object.keys(sd.emails).length}}];
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
      options: { customEmailConfig: '["ALL"]', forceReconnect: 60, trackLastMessageId: false },
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
      downloadAttachments: true,
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
