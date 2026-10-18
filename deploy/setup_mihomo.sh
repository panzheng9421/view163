#!/bin/sh
# view163: 用用户订阅在服务器起 mihomo 代理，供 app 采集走干净出口
# 路由策略：镜像本地 Clash 的「规则模式」—— 国内 5 源 DIRECT、其余走 vless 节点，
#          fake-ip 远程解析绕开 GFW 投毒。
# 不依赖 geoip.mmdb（避免 mihomo 启动下载卡死）
set -e

# 先杀掉可能残留的手动 mihomo 进程（精确路径，避免误杀本脚本）
pkill -9 -f '/opt/view163/vpn/mihomo' 2>/dev/null || true
systemctl stop mihomo 2>/dev/null || true
sleep 2

mkdir -p /opt/view163/vpn

# 1) 生成 mihomo 配置（vless 订阅链接列表 -> clash yaml）
cat > /opt/view163/vpn/gen_config.py << 'PYEOF'
import base64
from urllib.parse import unquote

RAW = "/opt/view163/vpn/subscription.raw"
OUT = "/opt/view163/vpn/config.yaml"

with open(RAW, "rb") as f:
    raw = f.read()
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
        p["ws-opts"] = {"path": q.get("path", ""), "headers": {"Host": q.get("host", "")}}
    if q.get("security") == "reality":
        p["reality-opts"] = {"public-key": q.get("pbk", ""), "short-id": q.get("sid", "")}
    p = {k: v for k, v in p.items() if v not in ("", None)}
    proxies.append(p)

names = [p["name"] for p in proxies]
L = []
L.append("mixed-port: 7890")
L.append("allow-lan: true")
L.append("bind-address: '*'")
L.append("mode: rule")
L.append("log-level: info")
L.append("geo-auto-update: false")
L.append("geodata-mode: dat")
L.append("")
# 镜像用户本地 Clash 的「规则模式」：国内源直连（阿里云北京到国内源本就快，
# 比绕海外节点还快），海外/CF 源走节点；fake-ip 让被代理的域名在节点侧远程解析，
# 绕开 GFW 投毒。国内直连的域名列进 fake-ip-filter，保证拿到真实 IP 走 DIRECT。
# 不依赖 geoip.mmdb（避免启动下载卡死）。
L.append("dns:")
L.append("  enable: true")
L.append("  enhanced-mode: fake-ip")
L.append("  fake-ip-range: 198.18.0.1/16")
L.append("  use-hosts: true")
L.append("  fake-ip-filter:")
L.append("    - '*.lan'")
L.append("  default-nameserver:")
L.append("    - 223.5.5.5")
L.append("    - 119.29.29.29")
L.append("  nameserver:")
L.append("    - 223.5.5.5")
L.append("    - 119.29.29.29")
L.append("")
L.append("proxies:")
for p in proxies:
    L.append(f'  - name: "{p["name"]}"')
    L.append("    type: vless")
    L.append(f"    server: {p['server']}")
    L.append(f"    port: {p['port']}")
    L.append(f"    uuid: {p['uuid']}")
    if p.get("flow"):
        L.append(f'    flow: "{p["flow"]}"')
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
# 智能分流（镜像本地 Clash 规则模式）：用 GeoIP 数据库自动判断——
# 中国 IP 的域名一律 DIRECT（国内源/豆瓣/60s 全部自动直连），其余(海外/CF/污染)走节点。
# 依赖 geoip.dat（已上传 /opt/view163/vpn/）。不再手写域名白名单，漏配=误判。
L.append("rules:")
L.append("  - GEOIP,CN,DIRECT")
L.append("  - MATCH,PROXY")
L.append("")
L.append("external-controller: 127.0.0.1:9090")

with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(L) + "\n")
print(f"OK: 生成 {len(proxies)} 个节点 -> {OUT}")
print("默认节点:", names[0] if names else "(无)")
PYEOF

python3 /opt/view163/vpn/gen_config.py

# 2) systemd 托管（避免后台进程吊住会话）
cat > /etc/systemd/system/mihomo.service << 'SEOF'
[Unit]
Description=Mihomo VPN proxy for view163 upstream
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/opt/view163/vpn/mihomo -d /opt/view163/vpn run
WorkingDirectory=/opt/view163/vpn
Restart=always
RestartSec=5
User=root
LimitNOFILE=1048576
StandardOutput=append:/var/log/mihomo.log
StandardError=append:/var/log/mihomo.log

[Install]
WantedBy=multi-user.target
SEOF

systemctl daemon-reload
systemctl enable mihomo
systemctl restart mihomo

sleep 5

echo "=== mihomo 进程 ==="
ps aux | grep '/opt/view163/vpn/mihomo' | grep -v grep | head
echo "=== 监听端口 ==="
(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep 7890 || echo "未监听 7890"

echo "=== 测 github(走 PROXY) ==="
curl -s -o /dev/null -w 'github=%{http_code} time=%{time_total}s\n' --max-time 20 -x 127.0.0.1:7890 https://github.com || echo "github 失败"
echo "=== 测 国内源 DIRECT ==="
for u in 'https://bfzyapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1' \
         'https://360zy.com/api.php/provide/vod?ac=videolist&wd=test&pg=1' \
         'https://ikunzyapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1' \
         'https://jszyapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1' \
         'https://www.mdzyapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1' \
         'https://caiji.dyttzyapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1' \
         'https://ffzy5.tv/api.php/provide/vod?ac=videolist&wd=test&pg=1' \
         'https://api.apibdzy.com/api.php/provide/vod?ac=videolist&wd=test&pg=1' \
         'https://cj.rycjapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1' ; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -x 127.0.0.1:7890 "$u" 2>/dev/null)
  echo "  $code  $u"
done
echo "=== 测 CF 源 zuid(PROXY) ==="
curl -s -o /dev/null -w 'zuid=%{http_code} time=%{time_total}s\n' --max-time 20 -x 127.0.0.1:7890 'https://api.zuidapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1' || echo "zuid 失败"
