# 部署到阿里云 ECS（view163 / LibreTV 二开）

本仓库已自带 `Dockerfile` + `docker-compose.yml`，部署即一条命令构建并跑起来。
下面是在一台**全新阿里云 ECS**（Ubuntu 22.04 / 24.04 或 CentOS 7+ 均可）上的完整流程。

---

## 0. 前置：ECS 安全组放行端口

在阿里云控制台 → 实例 → 安全组 → 入方向规则，放通：

| 端口 | 协议 | 用途 |
|------|------|------|
| 22   | TCP  | SSH（本来就有） |
| 80   | TCP  | HTTP（证书验证 / 临时验证用） |
| 443  | TCP  | HTTPS（正式访问） |
| 8080 | TCP  | **可选**：直连容器端口做临时验证；正式走反代后可不必长期开放 |

> 域名 `view163.com` 先解析 A 记录到 ECS 公网 IP（阿里云 DNS 控制台）。

---

## 1. 服务器装 Docker + Docker Compose

**Ubuntu：**
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
```

**CentOS：**
```bash
sudo yum install -y docker && sudo systemctl enable --now docker
sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

---

## 2. 拉取代码（你的仓库）

```bash
cd /opt
sudo git clone https://github.com/panzheng9421/view163.git
cd view163
```

---

## 3. 配置环境变量 `.env`（关键，否则全站空）

```bash
cp .env.example .env
nano .env        # 或用 vim
```

**必须改两处：**
- `PASSWORD=change-me` → 改成强密码（站点访问密码）
- `DEFAULT_SOURCES=...` → 预置采集站。**不填则全站无内容**。示例已给了一个实测可用的源，可换成你信任的源。

> ⚠️ 不要在本机开发用的 `.env.local` 里写代理口 `127.0.0.1:7897`——那是你 Windows 本机的 VPN 口，服务器上不存在。服务器直连上游源站即可（国内/境外节点一般可达 bfzy 等）。

---

## 4. 构建并启动（必须带 `--build`）

```bash
sudo docker compose up -d --build
```

> ⚠️ **务必带 `--build`**。本项目的 `docker-compose.yml` 默认 image 是本地标签 `view163:latest`，会构建**当前仓库的二开代码**。若漏写 `--build` 且手动改了 image 指向上游，会拉到 LibreTV 原版而非你的二开。

查看日志确认起来：
```bash
sudo docker compose logs -f
```

---

## 5. 验证服务正常

```bash
# 首页 HTML
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8080

# 源是否下发成功（看 defaultSources 是否非空）
curl -s http://localhost:8080/api/status | python3 -m json.tool | grep -A5 defaultSources
```

`defaultSources` 有内容 = 源已生效，全站不会空。

---

## 6. 域名 + HTTPS 反代（推荐 Caddy，自动证书）

### 方案 A：Caddy（最省心，自动 HTTPS）
```bash
sudo apt install -y caddy        # Ubuntu；CentOS 见 https://caddyserver.com/docs/install
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl restart caddy
```
Caddy 会自动为 `view163.com` 申请证书并 80→443 跳转。访问 `https://view163.com` 即可。

### 方案 B：Nginx + certbot
```bash
sudo cp deploy/nginx-view163.conf /etc/nginx/sites-available/view163.conf
sudo ln -s /etc/nginx/sites-available/view163.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d view163.com -d www.view163.com   # 自动签发并改写配置
```

---

## 7. 以后升级（拉新代码 + 重建）

```bash
cd /opt/view163
sudo git pull
sudo docker compose up -d --build
```

若想同步 LibreTV 上游新版本：
```bash
sudo git remote add upstream https://github.com/LibreSpark/LibreTV.git
sudo git fetch upstream
sudo git merge upstream/main      # 解决冲突后
sudo docker compose up -d --build
```

---

## 排错速查

- **全站空 / 搜不到片**：`.env` 没设 `DEFAULT_SOURCES`，或 JSON 格式错（数组、双引号）。看 `docker compose logs` 有无 `DEFAULT_SOURCES 解析失败`。
- **容器起不来**：`PASSWORD` 没设会直接报错——compose 用 `${PASSWORD:?...}` 强制。
- **媒体 403 / 播放失败**：服务器拉 m3u8 需**直连**（不走代理），源站 API 才可能需要代理；本项目服务端默认直连源站。若你的 ECS 到源站网络不通，再考虑在 `.env` 配 `UPSTREAM_PROXY`（指向一个服务器可达的代理，**绝不是** `127.0.0.1:7897`）。
- **端口冲突**：确认宿主机 8080 没被别的进程占用。
