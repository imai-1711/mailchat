
const decodeWord=(str)=>{if(!str||typeof str!=="string")return str||"";return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,(_,charset,enc,text)=>{try{const buf=enc.toUpperCase()==="B"?Buffer.from(text,"base64"):Buffer.from(text.replace(/_/g," ").replace(/=([0-9A-Fa-f]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))),"binary");try{return new TextDecoder(charset).decode(buf);}catch{return buf.toString("utf8");}}catch{return text;}});};
const fixMojibake=(str)=>{if(!str||typeof str!=="string")return str;if(!/[\xC0-\xFF]/.test(str))return str;try{const bytes=Buffer.from(str,"latin1");const decoded=new TextDecoder("utf-8").decode(bytes);if(/[　-鿿゠-ヿ぀-ゟ가-힯]/.test(decoded)&&!/[　-鿿]/.test(str))return decoded;}catch{}return str;};
const pa=(s)=>{if(!s)return{n:"不明",a:""};const fixed=fixMojibake(decodeWord(s));const m=fixed.match(/^(.+?)\s*<([^>]+)>/);return m?{n:m[1].trim()||m[2],a:m[2].trim()}:{n:fixed,a:fixed};};
const getBody=(item)=>{let txt=item.textPlain||item.text||"";if(txt&&(txt.includes("\x1b")||/\$B|\(B/.test(txt))){try{txt=new TextDecoder("iso-2022-jp").decode(Buffer.from(txt,"latin1"));}catch{txt=txt.replace(/\x1b\$[B@J]/g,"").replace(/\x1b\([BHJ]/g,"").trim();}}txt=fixMojibake(txt);if(txt.trim())return txt.substring(0,3000);const html=fixMojibake(item.textHtml||item.html||"");return html.replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<br\s*\/?>/gi,"\n").replace(/<p[^>]*>/gi,"\n").replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/\s+/g," ").trim().substring(0,3000);};
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
  const newEntry={id:String(item.attributes?.uid||Math.random()),messageId:mid,from:from.a,fromName:from.n,to:to.a,subject:subj,body,htmlBody,snippet:body.replace(/<[^>]*>/g,"").substring(0,120),date:item.date||new Date().toISOString(),read:!!(item.attributes?.flags?.["\\Seen"]),isSent:false,accountId:"work",inReplyTo:item.metadata?.["in-reply-to"]||"",references:item.metadata?.["references"]||"",attachments:atts};
  const existed=!!sd.emails[mid];
  if(!existed){sd.emails[mid]=newEntry;}else{if(atts.length>0)sd.emails[mid].attachments=atts;if(htmlBody)sd.emails[mid].htmlBody=htmlBody;const eb=sd.emails[mid].body||"";if(body.trim()&&(!eb.trim()||/[\xC0-\xFF]/.test(eb))){sd.emails[mid].body=body;sd.emails[mid].snippet=newEntry.snippet;}}
  results.push({json:{saved:mid,total:Object.keys(sd.emails).length,attachments:atts.length,updated:existed}});
}
return results;
