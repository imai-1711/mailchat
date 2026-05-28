"""
Generate _workflow_sdk_fixed.js with properly escaped jsCode strings
for use in n8n Workflow SDK (regular template literals, no String.raw).
"""
import os, re

BASE = r"C:\Users\User\Downloads\new-mailer"

def escape_for_template_literal(code: str) -> str:
    """Double backslashes and escape backticks for embedding in a JS template literal."""
    code = code.replace("\\", "\\\\")   # \ → \\
    code = code.replace("`", "\\`")     # ` → \`
    return code

inbox_raw = open(os.path.join(BASE, "_inbox_code.js"), encoding="utf-8").read()
sent_raw  = open(os.path.join(BASE, "_sent_code.js"),  encoding="utf-8").read()

inbox_esc = escape_for_template_literal(inbox_raw)
sent_esc  = escape_for_template_literal(sent_raw)

# メールを返す and 一括保存 are short enough to inline without escaping issues
# (their backslashes are already in the live workflow and known-correct)
get_emails_raw = r"""
const fixMojibake=(str)=>{if(!str||typeof str!=="string")return str;if(!/[\xC0-\xFF]/.test(str))return str;try{const bytes=Buffer.from(str,"latin1");const decoded=new TextDecoder("utf-8").decode(bytes);if(/[　-鿿゠-ヿ぀-ゟ가-힯]/.test(decoded)&&!/[　-鿿]/.test(str))return decoded;}catch{}return str;};
const fixEmail=(e)=>({...e,subject:fixMojibake(e.subject||""),body:fixMojibake(e.body||""),snippet:fixMojibake(e.snippet||""),fromName:fixMojibake(e.fromName||""),to:fixMojibake(e.to||""),});
const sd=$getWorkflowStaticData("global");
const all=Object.values(sd.emails||{}).map(fixEmail);
all.sort((a,b)=>new Date(b.date)-new Date(a.date));
return [{json:{emails:all,total:all.length,fetchedAt:new Date().toISOString()}}];
"""

bulk_save_raw = r"""
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
"""

get_emails_esc = escape_for_template_literal(get_emails_raw)
bulk_save_esc  = escape_for_template_literal(bulk_save_raw)

sdk_code = f"""import {{ workflow, node, trigger, newCredential }} from '@n8n/workflow-sdk';

const inboxCode = `{inbox_esc}`;

const sentCode = `{sent_esc}`;

const getEmailsCode = `{get_emails_esc}`;

const bulkSaveCode = `{bulk_save_esc}`;

const imapInbox = trigger({{
  type: 'n8n-nodes-base.emailReadImap',
  version: 2.1,
  config: {{
    name: 'IMAP - INBOX',
    parameters: {{
      mailbox: 'INBOX',
      postProcessAction: 'nothing',
      downloadAttachments: true,
      options: {{ customEmailConfig: '["ALL"]', forceReconnect: 60, trackLastMessageId: false }},
    }},
    credentials: {{ imap: newCredential('IMAP account') }},
  }},
}});

const imapSent = trigger({{
  type: 'n8n-nodes-base.emailReadImap',
  version: 2.1,
  config: {{
    name: 'IMAP - INBOX.Sent',
    parameters: {{
      mailbox: 'INBOX.Sent',
      postProcessAction: 'nothing',
      downloadAttachments: true,
      options: {{ customEmailConfig: '["ALL"]', forceReconnect: 60, trackLastMessageId: false }},
    }},
    credentials: {{ imap: newCredential('IMAP account') }},
  }},
}});

const saveInbox = node({{
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {{ name: '受信を保存', parameters: {{ mode: 'runOnceForAllItems', jsCode: inboxCode }} }},
}});

const saveSent = node({{
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {{ name: '送信を保存', parameters: {{ mode: 'runOnceForAllItems', jsCode: sentCode }} }},
}});

const webhookGet = trigger({{
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {{
    name: 'Webhook - メール取得',
    parameters: {{ httpMethod: 'GET', path: 'fetch-emails', responseMode: 'responseNode', options: {{}} }},
  }},
}});

const getEmails = node({{
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {{ name: 'メールを返す', parameters: {{ mode: 'runOnceForAllItems', jsCode: getEmailsCode }} }},
}});

const respond = node({{
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {{
    name: 'レスポンス',
    parameters: {{
      respondWith: 'json',
      responseBody: '={{{{ $json }}}}',
      options: {{ responseHeaders: {{ entries: [
        {{ name: 'Access-Control-Allow-Origin',  value: '*' }},
        {{ name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' }},
        {{ name: 'Access-Control-Allow-Headers', value: 'Content-Type' }},
      ] }} }},
    }},
  }},
}});

const webhookImport = trigger({{
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {{
    name: 'Webhook - 一括インポート',
    parameters: {{ httpMethod: 'POST', path: 'import-emails', responseMode: 'responseNode', options: {{}} }},
  }},
}});

const bulkSave = node({{
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {{ name: '一括保存', parameters: {{ mode: 'runOnceForAllItems', jsCode: bulkSaveCode }} }},
}});

const importDone = node({{
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {{
    name: 'インポート完了',
    parameters: {{
      respondWith: 'json',
      responseBody: '={{{{ $json }}}}',
      options: {{ responseHeaders: {{ entries: [{{ name: 'Access-Control-Allow-Origin', value: '*' }}] }} }},
    }},
  }},
}});

export default workflow('sRUVnMcEkIYzmbCJ', 'MailChat - メール取得')
  .add(imapInbox).to(saveInbox)
  .add(imapSent).to(saveSent)
  .add(webhookGet).to(getEmails).to(respond)
  .add(webhookImport).to(bulkSave).to(importDone);
"""

out = os.path.join(BASE, "_workflow_sdk_fixed.js")
with open(out, "w", encoding="utf-8") as f:
    f.write(sdk_code)
print("Written:", out)
print("Length:", len(sdk_code))
