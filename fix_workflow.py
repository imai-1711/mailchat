"""
Fix n8n-workflow-fetch-emails.json:
  1. getAttachments: merge JSON metadata + binary content (not exclusive OR)
  2. Process ALL items in the loop (not just items[0])
"""
import json, os

BASE = r"C:\Users\User\Downloads\new-mailer"
SRC  = os.path.join(BASE, "n8n-workflow-fetch-emails.json")

inbox_js = open(os.path.join(BASE, "_inbox_code.js"), encoding="utf-8").read()
sent_js  = open(os.path.join(BASE, "_sent_code.js"),  encoding="utf-8").read()

with open(SRC, "r", encoding="utf-8") as f:
    wf = json.load(f)

patched = []
for node in wf["nodes"]:
    if node["name"] == "受信を保存":
        node["parameters"]["jsCode"] = inbox_js
        patched.append("受信を保存")
    elif node["name"] == "送信を保存":
        node["parameters"]["jsCode"] = sent_js
        patched.append("送信を保存")

with open(SRC, "w", encoding="utf-8") as f:
    json.dump(wf, f, ensure_ascii=False, indent=2)

print("Patched:", patched)
print("Written:", SRC)
