# view163

> 基于 [LibreTV](https://github.com/LibreSpark/LibreTV) 二次开发的免费在线视频聚合搜索与观看平台。
>
> 🏠 **官网**：[view163.com](https://view163.com)

view163 是一个自用定制的影视聚合站：把多个采集站的内容在服务端并行搜索、聚合、去重后呈现，再用统一的播放器播放。它在原版 LibreTV 的基础上做了一系列面向「看片体验」的定制——内置精选默认源、首页榜单重组、搜索相关度排序、首访使用声明等，让界面只聚焦「看什么」，而不是堆砌源站信息。

技术栈：Next.js 15（App Router） + TypeScript + Tailwind CSS，播放内核为 ArtPlayer + hls.js，支持亮暗双主题。

## 核心特性

- **聚合搜索**：多采集站服务端并行搜索，个别源失败不影响整体结果
- **跨源同名聚合**：同名影片合并为一张卡片，展开即可比较和选择各来源
- **HLS 播放**：ArtPlayer + hls.js，广告分片过滤、自动连播、倍速、快捷键、移动端长按 3 倍速
- **直播 / IPTV**：M3U 订阅解析，`/live` 页面按分组浏览、搜索频道并站内播放（HLS + HTTP-FLV），支持 XMLTV 节目单（EPG）与频道收藏
- **进度同步**：播放进度与观看历史存于本机 IndexedDB，精确到秒的续播
- **源健康度**：连续失败的源按阶梯时长自动停用（30 分钟 → 24 小时 → 长期），可一键恢复
- **首页推荐**：豆瓣分类浏览 + 影视榜单（豆瓣周榜 / 百度热播，经 60s API），服务端直连 + 缓存
- **数据源订阅 / 分享**：一份 JSON 可同时下发点播源与直播源，也兼容 TVBOX 配置导入、可导出分享
- **PWA**：可安装到桌面 / 主屏幕，亮暗双主题无首屏闪烁

## 与上游 LibreTV 的主要差异

view163 在 LibreTV 之上做了以下定制（其余能力与原版一致）：

- **品牌与官网**：更名为 view163，官网 [view163.com](https://view163.com)
- **主源优先 + 多源兜底**：内置一组精选默认源，以主源（默认暴风）优先展示，主源不可用时自动回退其他源；搜索卡片只显示主源，切换/兜底在详情弹窗内完成，全程不堆砌源站信息
- **首页榜单重组**：顺序固定为「热播剧集 → 高分电影（豆瓣 movie_score）→ 热播电影 → 周榜们 → 动画新番」，并合并了热播电影 / 动画新番版块
- **搜索相关度排序**：按片名匹配度 + 画质（HD 优先、枪版/预告/解说降权）+ 年份新鲜度综合打分，避免「搜希望却跳枪版」这类问题
- **首访使用声明**：首次访问弹出一次性使用声明（localStorage 记忆，确认后不再弹出）
- **热搜词**：首屏热搜改为 7 个榜单首名

## 部署

### Docker（推荐）

```bash
# 在 .env 中设置 PASSWORD
echo "PASSWORD=your-password" > .env

# 源码构建并后台运行
docker compose up -d --build
```

`docker-compose.yml` 中服务监听 `8080:8080`，并可通过环境变量预置源与订阅（见下）。

### 手动运行

```bash
npm install
PASSWORD=your-password npm run build
PASSWORD=your-password npm start   # 监听 8080
```

本地开发：

```bash
PASSWORD=dev-password npm run dev   # http://localhost:8080
```

> ⚠️ **生产部署建议通过 HTTPS / localhost 访问**：生产模式下会话 cookie 带 `Secure` 标记，浏览器只在 HTTPS（或 localhost）下保存它。用 `http://服务器IP:端口` 访问时，会出现「密码正确却无法登录」的现象（登录请求实际成功，但 cookie 被浏览器丢弃）。请通过反向代理（Nginx / Caddy / Cloudflare）为站点套上 TLS 后再对外提供服务。

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PASSWORD` | 是 | 访问密码；未设置时站点会提示管理员配置 |
| `PROXY_SECRET` | 否 | 会话/代理签名密钥；不设置时从 PASSWORD 派生（多实例部署建议显式设置） |
| `DEFAULT_SOURCES` | 否 | 预置点播源（JSON 数组），用户端自动出现且默认勾选，如 `[{"name":"示例源","url":"https://example.com/api.php/provide/vod","detail":"https://example.com","isAdult":false}]` |
| `DEFAULT_LIVE_SOURCES` | 否 | 预置直播源（M3U 订阅），JSON 数组：`[{"name":"源名","url":"https://.../list.m3u","epg":"https://.../epg.xml.gz"}]` |
| `DEFAULT_SUBSCRIPTIONS` | 否 | 预置数据源订阅（LibreTV-SourceList JSON 链接，也接受 TVBOX 配置地址），JSON 数组 |
| `DEFAULT_RECOMMEND_SOURCE` | 否 | 首页推荐数据源默认值（`douban` / `bangumi` / `hot-list`，出厂默认 `hot-list`）；仅对未在设置中主动选择过的用户生效 |
| `DISABLE_AUTH` | 否 | 设为 `1` 关闭登录密码（仅限可信内网/本地环境） |
| `LIVE_ALLOW_PRIVATE` | 否 | 设为 `1` 时允许直播流代理访问内网/保留地址（自建 IPTV 场景），默认关闭以维持 SSRF 防护 |
| `REQUEST_TIMEOUT` | 否 | 代理上游请求超时（毫秒），默认 8000 |
| `MAX_RETRIES` | 否 | 代理请求重试次数，默认 1 |
| `SEARCH_MAX_PAGES` | 否 | 每个搜索源最多抓取的页数（1-50，默认 5） |
| `SEARCH_SOURCE_TIMEOUT_MS` | 否 | 单个搜索源的总死线（毫秒，3s-60s，默认 10000） |
| `USER_AGENT` | 否 | 代理请求使用的 UA（豆瓣封面防盗链等场景），默认 Chrome UA |
| `FALLBACK_CORS_PROXY` | 否 | 豆瓣推荐数据直连被拒时降级使用的 CORS 代理地址 |
| `COOKIE_SECURE` | 否 | 显式覆盖会话 cookie 的 `Secure` 标记；反向代理未正确传递 `x-forwarded-proto` 导致 HTTPS 下登录失效时，设为 `true` 可解 |
| `DEFAULT_IMAGE_MODE` | 否 | 图片加载模式（`proxy` / `direct` 等），控制封面是否走代理 |
| `UPSTREAM_PROXY` | 否 | 服务端拉取上游时的出口代理地址（如 `http://127.0.0.1:7897`），用于源站需要科学上网的场景 |

## 使用说明

1. **添加点播源**：设置 → 源管理 → 点播源 → 添加 API，填入 Apple CMS 采集站地址（如 `https://example.com/api.php/provide/vod`），可选填详情页地址。
2. **搜索**：勾选点播源后输入片名；搜索通过服务端聚合，结果按相关度排序，主源结果优先展示。
3. **播放**：详情弹窗选择剧集进入 `/watch`；支持快捷键（空格/←→/↑↓/F/Alt+←→）、移动端长按 3 倍速、自动连播。观看时后续分片自动缓存到本地，播放页可「下载本集」离线观看。
4. **进度与历史**：自动保存在本设备 IndexedDB，播放时自动同步最新剧集。
5. **配置迁移**：设置 → 数据 → 配置导入导出（兼容旧版 LibreTV-Settings JSON 的历史记录迁移）。

## 直播 / IPTV

1. **添加直播源**：设置 → 源管理 → 直播源 → 填入 M3U/M3U8 地址（可选填 XMLTV 节目单地址），添加后自动探活并显示频道数量；也可在「数据源订阅」中与点播源一起导入；部署者可用 `DEFAULT_LIVE_SOURCES` 预置。
2. **观看**：进入「直播」页，按分组筛选或搜索频道，点击即播；支持 HLS 与 HTTP-FLV，直连失败自动走代理通道重试。
3. **节目单**：频道带 `tvg-id` 且订阅配置了 EPG 时，展示当前/接下来节目。
4. **收藏与导出**：频道可收藏；订阅可一键导出为标准 M3U 文件，供 PotPlayer / VLC 使用。

> ⚠️ 项目不内置任何频道源，也不存储、不制作任何直播内容，仅提供第三方公开播放列表的解析与播放能力，内容的合法性由对应数据源负责。

## 数据源订阅 / 分享

数据源（点播源 + 直播源）可导出为一份 JSON 托管到公开 URL，他人在「设置 → 源管理 → 数据源订阅」里填入该 URL 即可订阅。订阅地址直接填 TVBOX 配置也行，服务端按结构自动识别格式。

订阅格式（LibreTV-SourceList JSON）：

```json
{
  "name": "我的源列表",
  "version": 2,
  "sources": [
    { "name": "示例点播源", "url": "https://example.com/api.php/provide/vod", "detail": "https://example.com", "isAdult": false }
  ],
  "liveSources": [
    { "name": "示例直播源", "url": "https://example.com/list.m3u", "epg": "https://example.com/epg.xml.gz" }
  ]
}
```

订阅由**服务端**拉取（经过 SSRF 校验），因此订阅地址无需配置 CORS，Gist、对象存储、任意静态托管均可。

## 安全说明

- 密码只保存在服务端环境变量中，前端不持有任何可重放凭证。
- 登录接口有 IP 速率限制（10 次 / 10 分钟）。
- 代理内置 SSRF 防护：拒绝内网/保留地址（含 DNS 解析后校验），仅放行 http(s)。
- 未登录会话仅允许代理图片类目标（豆瓣封面防盗链需要）。

## 免责声明

本项目不存储、不制作任何视频内容，仅提供第三方公开接口的聚合与播放能力，内容的合法性由对应数据源负责。请在使用前确认你所在地区的相关法律法规，合理使用。

## 鸣谢

- 上游项目 [LibreSpark/LibreTV](https://github.com/LibreSpark/LibreTV)（MIT 许可证）——本仓库为其二次开发分支，核心架构与大量能力继承自原项目。
- 播放器内核 [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) 与 [hls.js](https://github.com/video-dev/hls.js)。

view163 沿用上游 MIT 许可证，具体条款见仓库内 `LICENSE` 文件。
