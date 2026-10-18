import base64, os
from urllib.parse import unquote

RAW = "/opt/view163/vpn/subscription.raw"
OUT = "/opt/view163/vpn/config.yaml"

with open(RAW, "rb") as f:
    raw = f.read()

# 订阅是 base64(链接列表)；尝试解码，失败当明文
try:
    text = base64.b64decode(raw).decode("utf-8", "ignore")
except Exception:
    text = raw.decode("utf-8", "ignore")

def clean(v):
    return v.replace('"', "'")

proxies = []
for line in text.splitlines():
    line = line.strip()
    if not line or not line.startswith("vless://"):
        continue
    body = line[len("vless://"):]
    at = body.rfind("@")
    if at < 0:
        continue
    uuid = unquote(body[:at])
    rest = body[at + 1:]
    if "#" in rest:
        rest, name_enc = rest.split("#", 1)
        name = unquote(name_enc)
    else:
        name = "node"
    if "?" in rest:
        serverport, query = rest.split("?", 1)
    else:
        serverport, query = rest, ""
    if ":" in serverport:
        server, port = serverport.rsplit(":", 1)
    else:
        server, port = serverport, "443"
    q = {}
    for kv in query.split("&"):
        if "=" in kv:
            k, v = kv.split("=", 1)
            q[k] = unquote(v)
    p = {
        "name": clean(name),
        "type": "vless",
        "server": server,
        "port": int(port),
        "uuid": uuid,
        "flow": q.get("flow", ""),
        "tls": True,
        "servername": q.get("sni", ""),
        "client-fingerprint": q.get("fp", "") or None,
        "network": q.get("type", "tcp"),
    }
    if q.get("type") == "ws":
        p["ws-opts"] = {
            "path": q.get("path", ""),
            "headers": {"Host": q.get("host", "")},
        }
    if q.get("security") == "reality":
        p["reality-opts"] = {
            "public-key": q.get("pbk", ""),
            "short-id": q.get("sid", ""),
        }
    p = {k: v for k, v in p.items() if v not in ("", None)}
    proxies.append(p)

names = [p["name"] for p in proxies]

L = []
L.append("mixed-port: 7890")
L.append("mode: global")
L.append("allow-lan: false")
L.append("log-level: info")
L.append("")
L.append("proxies:")
for p in proxies:
    L.append(f'  - name: "{p["name"]}"')
    L.append("    type: vless")
    L.append(f"    server: {p['server']}")
    L.append(f"    port: {p['port']}")
    L.append(f"    uuid: {p['uuid']}")
    L.append(f'    flow: "{p.get("flow", "")}"')
    L.append("    tls: true")
    if p.get("servername"):
        L.append(f"    servername: {p['servername']}")
    if p.get("client-fingerprint"):
        L.append(f"    client-fingerprint: {p['client-fingerprint']}")
    L.append(f"    network: {p['network']}")
    if "ws-opts" in p:
        L.append("    ws-opts:")
        L.append(f'      path: "{p["ws-opts"]["path"]}"')
        L.append("      headers:")
        L.append(f'        Host: {p["ws-opts"]["headers"]["Host"]}')
    if "reality-opts" in p:
        L.append("    reality-opts:")
        L.append(f'      public-key: {p["reality-opts"]["public-key"]}')
        L.append(f'      short-id: {p["reality-opts"]["short-id"]}')
L.append("")
L.append("proxy-groups:")
L.append("  - name: PROXY")
L.append("    type: select")
L.append("    proxies:")
for n in names:
    L.append(f'      - "{n}"')
L.append("  - name: AUTO")
L.append("    type: url-test")
L.append("    url: https://www.gstatic.com/generate_204")
L.append("    interval: 300")
L.append("    proxies:")
for n in names:
    L.append(f'      - "{n}"')
L.append("")
L.append("rules:")
L.append("  - MATCH,PROXY")

with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(L) + "\n")

print(f"OK: 生成 {len(proxies)} 个节点 -> {OUT}")
print("默认节点:", names[0] if names else "(无)")
