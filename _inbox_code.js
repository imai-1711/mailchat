
const decodeWord=(str)=>{if(!str||typeof str!=="string")return str||"";return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,(_,charset,enc,text)=>{try{const buf=enc.toUpperCase()==="B"?Buffer.from(text,"base64"):Buffer.from(text.replace(/_/g," ").replace(/=([0-9A-Fa-f]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))),"binary");try{return new TextDecoder(charset).decode(buf);}catch{return buf.toString("utf8");}}catch{return text;}});};
const fixMojibake=(str)=>{if(!str||typeof str!=="string")return str;if(!/[\xC0-\xFF]/.test(str))return str;try{const bytes=Buffer.from(str,"latin1");const decoded=new TextDecoder("utf-8").decode(bytes);if(/[　-鿿゠-ヿ぀-ゟ가-힯]/.test(decoded)&&!/[　-鿿]/.test(str))return decoded;}catch{}return str;};
const pa=(s)=>{if(!s)return{n:"不明",a:""};const fixed=fixMojibake(decodeWord(s));const m=fixed.match(/^(.+?)\s*<([^>]+)>/);return m?{n:m[1].trim()||m[2],a:m[2].trim()}:{n:fixed,a:fixed};};
const getBody=(item)=>{let txt=item.textPlain||item.text||"";if(txt&&(txt.includes("\x1b")||/\$B|\(B/.test(txt))){try{txt=new TextDecoder("iso-2022-jp").decode(Buffer.from(txt,"latin1"));}catch{txt=txt.replace(/\x1b\$[B@J]/g,"").replace(/\x1b\([BHJ]/g,"").trim();}}txt=fixMojibake(txt);if(txt.trim())return txt.substring(0,3000);const html=fixMojibake(item.textHtml||item.html||"");return html.replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<br\s*\/?>/gi,"\n").replace(/<p[^>]*>/gi,"\n").replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/\s+/g," ").trim().substring(0,3000);};
const getHtmlBody=(item)=>{const html=fixMojibake(item.textHtml||item.html||"");if(!html||!/<img[\s>]/i.test(html))return "";return html.substring(0,50000);};
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
  const newEntry={id:String(item.attributes?.uid||Math.random()),messageId:mid,from:from.a,fromName:from.n,to:to.a,subject:subj,body,htmlBody,snippet:body.replace(/<[^>]*>/g,"").substring(0,120),date:item.date||new Date().toISOString(),read:!!(item.attributes?.flags?.["\\Seen"]),isSent:false,accountId:"work",inReplyTo:item.metadata?.["in-reply-to"]||"",references:item.metadata?.["references"]||"",attachments};
  const existed=!!sd.inboxEmails[mid];
  if(!existed){sd.inboxEmails[mid]=newEntry;}else{if(htmlBody)sd.inboxEmails[mid].htmlBody=htmlBody;if(attachments.length)sd.inboxEmails[mid].attachments=attachments;const eb=sd.inboxEmails[mid].body||"";if(body.trim()&&(!eb.trim()||/[\xC0-\xFF]/.test(eb))){sd.inboxEmails[mid].body=body;sd.inboxEmails[mid].snippet=newEntry.snippet;}}
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
