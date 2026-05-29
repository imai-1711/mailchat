
const decodeWord=(str)=>{if(!str||typeof str!=="string")return str||"";return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,(_,charset,enc,text)=>{try{const buf=enc.toUpperCase()==="B"?Buffer.from(text,"base64"):Buffer.from(text.replace(/_/g," ").replace(/=([0-9A-Fa-f]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))),"binary");try{return new TextDecoder(charset).decode(buf);}catch{return buf.toString("utf8");}}catch{return text;}});};
const fixMojibake=(str)=>{if(!str||typeof str!=="string")return str;if(!/[\xC0-\xFF]/.test(str))return str;try{const bytes=Buffer.from(str,"latin1");const decoded=new TextDecoder("utf-8").decode(bytes);if(/[　-鿿゠-ヿ぀-ゟ가-힯]/.test(decoded)&&!/[　-鿿]/.test(str))return decoded;}catch{}return str;};
const pa=(s)=>{if(!s)return{n:"不明",a:""};const fixed=fixMojibake(decodeWord(s));const m=fixed.match(/^(.+?)\s*<([^>]+)>/);return m?{n:m[1].trim()||m[2],a:m[2].trim()}:{n:fixed,a:fixed};};
const getBody=(item)=>{let txt=item.textPlain||item.text||"";if(txt&&(txt.includes("\x1b")||/\$B|\(B/.test(txt))){try{txt=new TextDecoder("iso-2022-jp").decode(Buffer.from(txt,"latin1"));}catch{txt=txt.replace(/\x1b\$[B@J]/g,"").replace(/\x1b\([BHJ]/g,"").trim();}}txt=fixMojibake(txt);if(txt.trim())return txt.substring(0,3000);const html=fixMojibake(item.textHtml||item.html||"");return html.replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<br\s*\/?>/gi,"\n").replace(/<p[^>]*>/gi,"\n").replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/\s+/g," ").trim().substring(0,3000);};
const getHtmlBody=(item)=>{const html=fixMojibake(item.textHtml||item.html||"");if(!html||!/<img[\s>]/i.test(html))return "";return html.substring(0,50000);};
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
    const subjBase=subj.replace(/^(Re|Fwd|Fw|RE|FWD|FW):\s*/gi,"").trim();
    const fakeKey=Object.keys(sd.sentEmails).find(k=>{
      if(!k.includes("@mailchat"))return false;
      const e=sd.sentEmails[k];
      if((e.to||"").toLowerCase()!==(to.a||"").toLowerCase())return false;
      const eSub=(e.subject||"").replace(/^(Re|Fwd|Fw|RE|FWD|FW):\s*/gi,"").trim();
      if(eSub!==subjBase)return false;
      return Math.abs(new Date(e.date)-new Date(newEntry.date))<60*60*1000;
    });
    if(fakeKey)delete sd.sentEmails[fakeKey];
    sd.sentEmails[mid]=newEntry;
  }else{
    if(htmlBody)sd.sentEmails[mid].htmlBody=htmlBody;
    const eb=sd.sentEmails[mid].body||"";
    if(body.trim()&&(!eb.trim()||/[\xC0-\xFF]/.test(eb))){sd.sentEmails[mid].body=body;sd.sentEmails[mid].snippet=newEntry.snippet;}
  }
  results.push({json:{saved:mid,total:Object.keys(sd.sentEmails).length,updated:existed}});
}
const MAX=500;const ks=Object.keys(sd.sentEmails);
if(ks.length>MAX){ks.sort((a,b)=>new Date(sd.sentEmails[a]?.date||0)-new Date(sd.sentEmails[b]?.date||0)).slice(0,ks.length-MAX).forEach(k=>delete sd.sentEmails[k]);}
return results;
