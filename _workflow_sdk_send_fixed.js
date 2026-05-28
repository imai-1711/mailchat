import { workflow, node, trigger, newCredential } from '@n8n/workflow-sdk';

const prepareCode = `
const items = $input.all();
const b = items[0].json.body || items[0].json;
const from = b.from || '';
const to = b.to || '';
const subject = b.subject || '';
const bodyText = b.body || '';
const cc = b.cc || '';
const bcc = b.bcc || '';
const inReplyTo = b.inReplyTo || '';
const references = b.references || '';
const accountId = b.accountId || 'work';
const attachments = Array.isArray(b.attachments) ? b.attachments : [];
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
const attachmentsMeta = attachments.map(a => {
  const filename = a.filename || 'attachment';
  const mimeType = a.mimeType || 'application/octet-stream';
  const size = a.size || 0;
  const content = a.content || '';
  const canPreview = !!content && mimeType.startsWith('image/') && size <= MAX_PREVIEW_BYTES;
  return {
    filename, mimeType, size, hasPreview: canPreview,
    ...(canPreview ? { dataUrl: 'data:' + mimeType + ';base64,' + content } : {}),
  };
});
const outputItem = {
  json: { from, to, subject, bodyText, cc, bcc, inReplyTo, references, accountId,
    attachmentNames: attachments.map((_, i) => 'att_' + i).join(','), attachmentsMeta },
  binary: {}
};
attachments.forEach((att, i) => {
  outputItem.binary['att_' + i] = {
    data: att.content || '',
    mimeType: att.mimeType || 'application/octet-stream',
    fileName: att.filename || ('attachment_' + i),
    fileSize: att.size || 0,
  };
});
return [outputItem];
`;

const sentMessageCode = `
const prep = $('添付変換 & フィールド整形').first().json;
const mid = '<mailchat-' + Date.now() + '-' + Math.random().toString(36).slice(2,8) + '@mailchat>';
const now = new Date().toISOString();
const sentMessage = {
  id: mid, messageId: mid,
  from: prep.from || '', fromName: prep.from || '',
  to: prep.to || '', subject: prep.subject || '',
  body: prep.bodyText || '',
  snippet: (prep.bodyText || '').substring(0, 120),
  date: now, read: true, isSent: true,
  accountId: prep.accountId || 'work',
  inReplyTo: prep.inReplyTo || '', references: prep.references || '',
  attachments: Array.isArray(prep.attachmentsMeta) ? prep.attachmentsMeta : [],
};
return [{ json: { sentMessage } }];
`;

const webhookSend = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook - メール送信',
    parameters: { httpMethod: 'POST', path: 'send-email', responseMode: 'responseNode', options: {} },
  },
});

const prepare = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: '添付変換 & フィールド整形', parameters: { mode: 'runOnceForAllItems', jsCode: prepareCode } },
});

const smtp = node({
  type: 'n8n-nodes-base.emailSend',
  version: 2.1,
  config: {
    name: 'SMTP - むうむうメール',
    parameters: {
      fromEmail: '={{ $json.from }}',
      toEmail: '={{ $json.to }}',
      subject: '={{ $json.subject }}',
      emailFormat: 'text',
      text: '={{ $json.bodyText }}',
      options: {
        appendAttribution: false,
        attachments: '={{ $json.attachmentNames }}',
        ccEmail: '={{ $json.cc }}',
        bccEmail: '={{ $json.bcc }}',
      },
    },
    credentials: { smtp: newCredential('SMTP account') },
  },
});

const createSentMessage = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'sentMessage 作成', parameters: { mode: 'runOnceForAllItems', jsCode: sentMessageCode } },
});

const saveCache = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'キャッシュ保存',
    parameters: {
      method: 'POST',
      url: 'https://n8n.niida-imai.work/webhook/import-emails',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: "={{ { \"emails\": [$(\"sentMessage 作成\").first().json.sentMessage] } }}",
      options: { response: { response: { neverError: true } } },
    },
  },
});

const respond = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'レスポンス返却',
    parameters: {
      respondWith: 'json',
      responseBody: "={{ { \"success\": true, \"sentMessage\": $(\"sentMessage 作成\").first().json.sentMessage } }}",
      options: {
        responseHeaders: {
          entries: [
            { name: 'Access-Control-Allow-Origin', value: '*' },
            { name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
            { name: 'Access-Control-Allow-Headers', value: 'Content-Type' },
          ],
        },
      },
    },
  },
});

export default workflow('YiVDaNWrzE8ra73t', 'MailChat - メール送信')
  .add(webhookSend).to(prepare).to(smtp).to(createSentMessage).to(saveCache).to(respond);
