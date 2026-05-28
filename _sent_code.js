
const decodeWord=(str)=>{if(!str||typeof str!=="string")return str||"";return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,(_,charset,enc,text)=>{try{const buf=enc.toUpperCase()==="B"?Buffer.from(text,"base64"):Buffer.from(text.replace(/_/g," ").replace(/=([0-9A-Fa-f]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))),"binary");try{return new TextDecoder(charset).decode(buf);}catch{return buf.toString("utf8");}}catch{return text;}});};
const fixMojibake=(str)=>{if(!str||typeof str!=="string")return str;if(!/[\xC0-\xFF]/.test(str))return str;try{const bytes=Buffer.from(str,"latin1");const decoded=new TextDecoder("utf-8").decode(bytes);if(/[　-鿿゠-ヿ぀-ゟ가-힯]/.test(decoded)&&!/[　-鿿]/.test(str))return decoded;}catch{}return str;};
const pa=(s)=>{if(!s)return{n:"不明",a:""};const fixed=fixMojibake(decodeWord(s));const m=fixed.match(/^(.+?)\s*<([^>]+)>/);return m?{n:m[1].trim()||m[2],a:m[2].trim()}:{n:fixed,a:fixed};};
const getBody=(item)=>{let txt=item.textPlain||item.text||"";if(txt&&(txt.includes("\x1b")||/\$B|\(B/.test(txt))){try{txt=new TextDecoder("iso-2022-jp").decode(Buffer.from(txt,"latin1"));}catch{txt=txt.replace(/\x1b\$[B@J]/g,"").replace(/\x1b\([BHJ]/g,"").trim();}}txt=fixMojibake(txt);if(txt.trim())return txt.substring(0,3000);const html=fixMojibake(item.textHtml||item.html||"");return html.replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<br\s*\/?>/gi,"\n").replace(/<p[^>]*>/gi,"\n").replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/\s+/g," ").trim().substring(0,3000);};
// HTMLメール本文（CID参照を含む場合に保存）
const getHtmlBody=(item)=>{const html=fixMojibake(item.textHtml||item.html||"");if(!html||!html.includes("cid:"))return "";return html.substring(0,50000);};
const isFsRef=(d)=>!d||d==="filesystem-v2";
const getAttachments=async(item,bin,itemRef)=>{
  const jsonAtts=item.attachments||[];
  const binEntries=bin?Object.entries(bin):[];
  let merged;
  if(jsonAtts.length>0){
    merged=await Promise.all(jsonAtts.map(async(a,i)=>{
      const bKey=binEntries[i]?.[0]||null;
      const bv=binEntries[i]?.[1]||null;
      let content=a.content||"";
      if(isFsRef(content)&&bKey){
        try{const buf=await this.helpers.getBinaryDataBuffer(itemRef,bKey);content=buf.toString("base64");}catch{}
      }
      return{
        ...a,
        filename:a.filename||a.name||bv?.fileName||bv?.filename||("attachment_"+i),
        mimeType:a.mimeType||a.contentType||a.type||bv?.mimeType||"application/octet-stream",
        size:a.size||bv?.fileSize||0,
        content,
        contentId:a.contentId||a.cid||bv?.contentId||bv?.id||"",
      };
    }));
  }else{
    merged=await Promise.all(binEntries.map(async([k,v])=>{
      let content=v.data||"";
      if(isFsRef(content)){
        try{const buf=await this.helpers.getBinaryDataBuffer(itemRef,k);content=buf.toString("base64");}catch{}
      }
      return{
        filename:v.fileName||v.filename||k,
        mimeType:v.mimeType||"application/octet-stream",
        size:v.fileSize||0,
        content,
        contentId:v.contentId||v.id||"",
        contentDisposition:v.contentDisposition||"attachment",
      };
    }));
  }
  return merged
    .filter(a=>a&&(a.filename||a.name||a.content||a.contentId))
    .map(a=>{
      const mime=a.mimeType||a.contentType||a.type||"application/octet-stream";
      const sz=typeof a.size==="number"?a.size:typeof a.content==="string"&&a.content?Buffer.from(a.content,"base64").length:0;
      const dataUrl=(typeof a.content==="string"&&a.content&&!isFsRef(a.content)&&sz<=5*1024*1024)
        ?("data:"+mime+";base64,"+a.content)
        :undefined;
      const contentId=(a.contentId||a.cid||"").replace(/^<|>$/g,"");
      return{
        filename:fixMojibake(decodeWord(a.filename||a.name||(mime.startsWith("image/")?"image."+((mime).split("/")[1]||"jpg"):"attachment"))),
        mimeType:mime,
        size:sz,
        isInline:a.contentDisposition==="inline"||!!contentId,
        contentId,
        dataUrl,
      };
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
  const atts=await getAttachments(item,bin,idx);
  const newEntry={id:String(item.attributes?.uid||Math.random()),messageId:mid,from:from.a,fromName:from.n,to:to.a,subject:subj,body,htmlBody,snippet:body.replace(/<[^>]*>/g,"").substring(0,120),date:item.date||new Date().toISOString(),read:true,isSent:true,accountId:"work",inReplyTo:item.metadata?.["in-reply-to"]||"",references:item.metadata?.["references"]||"",attachments:atts};
  const existed=!!sd.emails[mid];
  if(!existed){
    // IMAP取得の実際のMessageIDが届いたとき、同じメールのfake mailchat IDを削除（重複排除）
    const subjBase=subj.replace(/^(Re|Fwd|Fw|RE|FWD|FW):\s*/gi,"").trim();
    const fakeKey=Object.keys(sd.emails).find(k=>{
      if(!k.includes("@mailchat"))return false;
      const e=sd.emails[k];
      if((e.to||"").toLowerCase()!==(to.a||"").toLowerCase())return false;
      const eSub=(e.subject||"").replace(/^(Re|Fwd|Fw|RE|FWD|FW):\s*/gi,"").trim();
      if(eSub!==subjBase)return false;
      return Math.abs(new Date(e.date)-new Date(newEntry.date))<60*60*1000;
    });
    if(fakeKey)delete sd.emails[fakeKey];
    sd.emails[mid]=newEntry;
  }else{
    if(atts.length>0)sd.emails[mid].attachments=atts;
    if(htmlBody)sd.emails[mid].htmlBody=htmlBody;
    const eb=sd.emails[mid].body||"";
    if(body.trim()&&(!eb.trim()||/[\xC0-\xFF]/.test(eb))){sd.emails[mid].body=body;sd.emails[mid].snippet=newEntry.snippet;}
  }
  results.push({json:{saved:mid,total:Object.keys(sd.emails).length,attachments:atts.length,updated:existed}});
}
return results;
