"""
MailChat 送信メール一括インポートスクリプト v2
Thunderbird の MBOX ファイルを読み込んで n8n にインポートします

使い方:
  python import_sent.py "C:\\...\\INBOX.sbd\\Sent"
"""

import mailbox
import json
import base64
import email.header
import email.utils
import re
import sys
import os
import urllib.request
import urllib.error

# ─── 設定 ─────────────────────────────────────────────────
IMPORT_URL  = "http://192.168.1.106:5678/webhook/import-emails"
ACCOUNT_ID  = "work"
BATCH_SIZE  = 30
MAX_BODY    = 3000
MAX_PREVIEW_BYTES = 5 * 1024 * 1024
# ──────────────────────────────────────────────────────────


def decode_header_str(raw):
    """RFC2047 エンコードされたヘッダーをデコード"""
    if not raw:
        return ""
    try:
        parts = email.header.decode_header(raw)
        result = []
        for part, charset in parts:
            if isinstance(part, bytes):
                if charset:
                    try:
                        result.append(part.decode(charset, errors='replace'))
                    except LookupError:
                        result.append(part.decode('utf-8', errors='replace'))
                else:
                    # charset 不明 → UTF-8 / Latin-1 の Mojibake を試みる
                    try:
                        decoded = part.decode('utf-8')
                        result.append(decoded)
                    except UnicodeDecodeError:
                        result.append(part.decode('latin-1', errors='replace'))
            else:
                result.append(str(part))
        return fix_mojibake("".join(result))
    except Exception:
        return str(raw)


def fix_mojibake(s):
    """UTF-8バイト列をLatin-1として誤読した文字化けを修復"""
    if not s:
        return s
    try:
        # Latin-1としてエンコードし直してUTF-8でデコード
        raw = s.encode('latin-1')
        decoded = raw.decode('utf-8')
        # CJK文字が含まれていれば成功とみなす
        if re.search(r'[　-鿿゠-ヿ぀-ゟ]', decoded):
            return decoded
    except (UnicodeDecodeError, UnicodeEncodeError):
        pass
    return s


def parse_addr(addr_str):
    """'名前 <email>' 形式をパース"""
    if not addr_str:
        return {"name": "不明", "email": ""}
    try:
        decoded = decode_header_str(addr_str)
        name, addr = email.utils.parseaddr(decoded)
        name = fix_mojibake(name) if name else (addr.split("@")[0] if addr else "不明")
        return {"name": name, "email": addr}
    except Exception:
        return {"name": addr_str, "email": ""}


def get_body(msg):
    """
    メール本文を取得（multipart 対応、ISO-2022-JP/UTF-8/Latin-1 自動判定）
    text/plain 優先、なければ text/html からタグ除去
    """
    plain = _extract_part(msg, 'text/plain')
    if plain:
        return plain[:MAX_BODY]
    html = _extract_part(msg, 'text/html')
    if html:
        # HTMLタグ除去
        text = re.sub(r'<style[^>]*>[\s\S]*?</style>', '', html, flags=re.I)
        text = re.sub(r'<script[^>]*>[\s\S]*?</script>', '', text, flags=re.I)
        text = re.sub(r'<br\s*/?>', '\n', text, flags=re.I)
        text = re.sub(r'<p[^>]*>', '\n', text, flags=re.I)
        text = re.sub(r'<[^>]+>', ' ', text)
        text = text.replace('&nbsp;', ' ').replace('&amp;', '&')
        text = text.replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"')
        text = re.sub(r'\s+', ' ', text).strip()
        return text[:MAX_BODY]
    return ""


def _extract_part(msg, content_type):
    """指定した Content-Type のパートを探して文字列として返す"""
    if msg.is_multipart():
        for part in msg.walk():
            if str(part.get('Content-Disposition', '')).startswith('attachment'):
                continue  # 添付は除外
            if part.get_content_type() == content_type:
                raw = part.get_payload(decode=True)
                if raw:
                    return _decode_bytes(raw, part.get_content_charset())
    else:
        if msg.get_content_type() == content_type:
            raw = msg.get_payload(decode=True)
            if raw:
                return _decode_bytes(raw, msg.get_content_charset())
    return None


def _decode_bytes(raw, charset):
    """バイト列を文字列にデコード（文字化け修復付き）"""
    charset = charset or ''
    # ISO-2022-JP 系
    if 'iso-2022' in charset.lower() or '2022' in charset.lower():
        try:
            return raw.decode('iso-2022-jp', errors='replace')
        except Exception:
            pass
    # Shift_JIS 系
    if 'shift' in charset.lower() or 'sjis' in charset.lower():
        try:
            return raw.decode('shift_jis', errors='replace')
        except Exception:
            pass
    # UTF-8 優先
    try:
        decoded = raw.decode('utf-8')
        return fix_mojibake(decoded)
    except UnicodeDecodeError:
        pass
    # charset 指定があれば試す
    if charset:
        try:
            return raw.decode(charset, errors='replace')
        except (LookupError, Exception):
            pass
    # 最終フォールバック: latin-1
    return raw.decode('latin-1', errors='replace')


def get_attachments(msg):
    """添付ファイルのメタデータを取得。画像は小さいものだけプレビュー用dataUrlも持たせる。"""
    atts = []
    if not msg.is_multipart():
        return atts
    for part in msg.walk():
        cd = str(part.get('Content-Disposition', ''))
        ct = part.get_content_type()
        filename = part.get_filename()
        if filename:
            filename = decode_header_str(filename)
        elif 'attachment' in cd:
            filename = 'attachment'
        else:
            continue
        if filename:
            # サイズ取得（バイナリをデコードして計測）
            payload = part.get_payload(decode=True)
            size = len(payload) if payload else 0
            att = {
                'filename': filename,
                'mimeType': ct or 'application/octet-stream',
                'size': size,
            }
            if payload and ct.startswith('image/') and size <= MAX_PREVIEW_BYTES:
                att['dataUrl'] = 'data:{};base64,{}'.format(ct, base64.b64encode(payload).decode('ascii'))
            atts.append(att)
    return atts


def post_batch(batch):
    """n8n にバッチ POST"""
    data = json.dumps({"emails": batch}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        IMPORT_URL,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            resp = json.loads(res.read().decode("utf-8"))
            return resp.get("total", "?"), resp.get("added", 0), resp.get("updated", 0)
    except urllib.error.HTTPError as e:
        print(f"  HTTPエラー {e.code}: {e.reason}")
        return None, 0, 0
    except Exception as ex:
        print(f"  送信エラー: {ex}")
        return None, 0, 0


def main():
    print("=" * 60)
    print("  MailChat 送信メール一括インポート v2")
    print("=" * 60)
    print()

    mbox_path = sys.argv[1] if len(sys.argv) > 1 else input("MBOXファイルのフルパス: ").strip().strip('"')

    if not os.path.isfile(mbox_path):
        print(f"エラー: ファイルが見つかりません: {mbox_path}")
        sys.exit(1)

    print(f"ファイル: {mbox_path}")
    print(f"送信先:   {IMPORT_URL}")
    print()

    mbox = mailbox.mbox(mbox_path)
    total_msgs = sum(1 for _ in mbox)
    print(f"メール数: {total_msgs} 件\n")

    mbox = mailbox.mbox(mbox_path)
    batch = []
    processed = 0
    skipped = 0
    total_added = 0
    total_updated = 0

    for i, msg in enumerate(mbox):
        try:
            subject    = decode_header_str(msg.get("Subject", ""))
            from_info  = parse_addr(msg.get("From", ""))
            to_info    = parse_addr(msg.get("To", ""))
            cc_str     = decode_header_str(msg.get("Cc", ""))
            message_id = msg.get("Message-ID", "").strip().strip("<>")
            message_id = f"<{message_id}>" if message_id else f"import_{i}"
            in_reply_to= msg.get("In-Reply-To", "").strip()
            references = msg.get("References", "").strip()
            date_str   = msg.get("Date", "")
            body       = get_body(msg)
            snippet    = re.sub(r'\s+', ' ', body.replace('\r','').replace('\n',' '))[:120]
            attachments= get_attachments(msg)

            batch.append({
                "id":          message_id,
                "messageId":   message_id,
                "from":        from_info["email"],
                "fromName":    from_info["name"],
                "to":          to_info["email"],
                "cc":          cc_str,
                "subject":     subject or "(件名なし)",
                "body":        body,
                "snippet":     snippet,
                "date":        date_str,
                "read":        True,
                "isSent":      True,
                "accountId":   ACCOUNT_ID,
                "inReplyTo":   in_reply_to,
                "references":  references,
                "attachments": attachments,
            })
        except Exception as ex:
            skipped += 1
            print(f"  スキップ (#{i}): {ex}")
            continue

        if len(batch) >= BATCH_SIZE:
            cache_total, added, updated = post_batch(batch)
            total_added += added
            total_updated += updated
            processed += len(batch)
            pct = int(processed / total_msgs * 100) if total_msgs else 0
            status = f"キャッシュ合計 {cache_total}件 (+{added} ~{updated})" if cache_total else "送信失敗"
            print(f"  [{pct:3d}%] {processed}/{total_msgs} 件 | {status}")
            batch = []

    if batch:
        cache_total, added, updated = post_batch(batch)
        if added is not None:
            total_added += added
            total_updated += updated
        processed += len(batch)

    print()
    print("=" * 60)
    print(f"完了! {processed}件処理（新規: {total_added} / 更新: {total_updated} / スキップ: {skipped}）")
    print()
    print("MailChat の「⟳ 取得」を押すと送信済みメールが表示されます。")
    print("=" * 60)


if __name__ == "__main__":
    main()
