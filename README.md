# view163

> 基于 [LibreTV](https://github.com/LibreSpark/LibreTV) 二次开发的免费在线视频聚合搜索与观看平台。
>
> 🏠 **官网**：[view163.com](https://view163.com)

view163 是一个自用定制的影视聚合站：把多个采集站的内容在服务端并行搜索、聚合、去重后呈现，再用统一的播放器播放。它在原版 LibreTV 的基础上做了一系列面向「看片体验」与「公众站点合规」的定制——内置精选默认源、搜索相关度排序、首页榜单与热搜重组、内容安全过滤、首访使用声明等，让界面只聚焦「看什么」，而不是堆砌源站信息。

技术栈：Next.js 15（App Router） + TypeScript + Tailwind CSS，播放内核为 ArtPlayer + hls.js，支持亮暗双主题，可安装为 PWA。

![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white) ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?logo=tailwindcss&logoColor=white) ![ArtPlayer](https://img.shields.io/badge/ArtPlayer-5.2-FF6B35) ![License](https://img.shields.io/badge/License-AGPL--3.0-lightgrey)

## 核心特性

- **聚合搜索**：多采集站服务端并行搜索，个别源失败不影响整体结果
- **跨源同名聚合**：同名影片合并为一张卡片。默认优先展示首选源版本（点击直达播放）；首选源未收录该片时，才展开列出其他可用源供选择
- **HLS 播放**：ArtPlayer + hls.js，广告分片过滤、自动连播、倍速、快捷键、移动端长按 3 倍速
- **进度同步**：播放进度与观看历史存于本机 IndexedDB，精确到秒的续播
- **源健康度排序**：记录每个源的响应速度与连续失败次数，搜索时成功且快的源结果前置（提权）、连续失败的源结果后置（降权）；**所有源都参与搜索、绝不因一次抖动就被踢出**
- **首页推荐**：影视热榜（豆瓣直连榜单 + 60s 周榜）、豆瓣热门、Bangumi 新番三种数据源可选，服务端直连 + 缓存；首屏「热门搜索」取自各榜单榜首真片名
- **PWA**：可安装到桌面 / 主屏幕，亮暗双主题无首屏闪烁

## 与上游 LibreTV 的主要差异

view163 在 LibreTV 之上做了以下定制（其余能力与原版一致）：

- **品牌与官网**：更名为 view163，官网 [view163.com](https://view163.com)
- **不露源（界面铁律）**：前端绝不暴露任何源站信息（源名、采集站域名）。卡片只展示片名/封面/年份，跨源切换在详情弹窗内完成，站点全程只讲「看什么」。默认源由部署者通过 `DEFAULT_SOURCES` 预置，用户端自动出现且默认启用，但不向访客展示源名
- **源健康度只排序不判死**（2026-10-17 改）：原版「连续失败按 30 分钟 → 24 小时 → 长期 停用、可恢复」整套已删除。改为按健康度打分排序——成功源前置、连续失败源后置，但所有源都参与搜索，避免「网络抖一次就被判死、还得手动恢复」
- **首页榜单与热搜重组**：推荐区默认「影视热榜」模式，滑轨顺序固定为「热播剧集 → 高分电影 → 热播电影 → 周榜们 → 动画新番（垫底）」；「热门搜索」改为 7 个榜单榜首真片名，点击即搜
- **搜索相关度排序**：按片名匹配度 + 画质（HD·完结优先、枪版/预告/解说降权）+ 年份新鲜度综合打分，避免「搜希望却跳枪版」这类问题
- **内容安全过滤（强制）**：面向公众的内容安全策略，详见下方「内容安全」
- **设置收敛**：访客侧设置只保留「偏好设置」与「我的账号」两个分组，源管理 / 数据导入导出收敛为部署时环境变量配置，不向访客开放自助改源

## 内容安全

view163 定位为面向公众的影视站，内容安全是默认开启、不可被访客绕过的硬策略：

- **分类黑名单过滤**：对结果分类名做关键词（含词根）匹配并做大小写 / 空格归一化，命中即过滤。覆盖伦理 / 福利 / 倫理 / 擦边 / 里番动漫 / 门事件 / 无码 / 有码 / SWAG / 网红主播 / 色情片 / 自拍偷拍 / 写真 / 热舞 / 秀人 / 私房 / 大尺度等类别
- **三处调用闭环**：搜索聚合完成后（服务端）、分类页、首页流式增量渲染段，三处均过同一过滤函数，避免成人卡先闪现再消失
- **强制开启、防 API 绕过**：`ADULT_FILTER_ENFORCED = true`，服务端忽略请求体里的 `filterAdult:false`，即便直接打接口也无法拿到未过滤结果；本地存储里的过滤开关也会被强制纠正为开启
- **不提供关闭入口**：与此相关的设置项（封面图加载、首页与内容）已从访客设置面板隐藏，普通访客无法关闭过滤

## 部署

### Docker（推荐）

```bash
# 在 .env 中设置 PASSWORD 与至少一个默认源
echo "PASSWORD=your-password" > .env
echo 'DEFAULT_SOURCES=[{"name":"示例源","url":"https://example.com/api.php/provide/vod","isAdult":false}]' >> .env

# 源码构建并后台运行
docker compose up -d --build
```

> ⚠️ **必须预置源**：view163 不在代码里硬编码任何采集站。未设置 `DEFAULT_SOURCES` / `DEFAULT_SUBSCRIPTIONS` 时，全站搜索与首页推荐都会为空。部署时务必至少预置一个可用的点播源。

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

| 变量                         | 必填 | 说明                                                                                                                                                           |
| -------------------------- | -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PASSWORD`                 | 是* | 访问密码；未设置时站点会提示管理员配置。*仅当 `DISABLE_AUTH=true` 时可省略                                                                                                                     |
| `DISABLE_AUTH`             | 否  | 设为 `true` 彻底关闭访问密码，进站即用、不弹验证框（自用 / 内网部署）。公网开放时勿开                                                                                                        |
| `PROXY_SECRET`             | 否  | 会话/代理签名密钥；不设置时从 PASSWORD 派生（多实例部署建议显式设置）                                                                                                                     |
| `DEFAULT_SOURCES`          | 否* | 预置点播源（JSON 数组），用户端自动出现且默认启用，如 `[{"name":"示例源","url":"https://example.com/api.php/provide/vod","detail":"https://example.com","isAdult":false}]`。**不填则全站无内容** |
| `DEFAULT_SUBSCRIPTIONS`    | 否  | 预置数据源订阅（LibreTV-SourceList JSON 链接，也接受 TVBOX 配置地址），JSON 数组                                                                                                   |
| `DEFAULT_RECOMMEND_SOURCE` | 否  | 首页推荐数据源默认值（`douban` / `bangumi` / `hot-list`，出厂默认 `hot-list`）；仅对未在设置中主动选择过的用户生效                                                                              |
| `REQUEST_TIMEOUT`          | 否  | 代理上游请求超时（毫秒），默认 8000                                                                                                                                         |
| `MAX_RETRIES`              | 否  | 代理请求重试次数，默认 1                                                                                                                                                |
| `SEARCH_MAX_PAGES`         | 否  | 每个搜索源最多抓取的页数（1-50，默认 5）                                                                                                                                      |
| `SEARCH_SOURCE_TIMEOUT_MS` | 否  | 单个搜索源的总死线（毫秒，3s-60s，默认 10000）；源站在境外/慢链路时可调大                                                                                                                       |
| `CATEGORY_PAGE_TIMEOUT_MS` | 否  | 分类页单页上游超时（毫秒，默认 9000）；国内机房直连境外源常见 3~15s，建议按实测调到 20000                                                                                                             |
| `USER_AGENT`               | 否  | 代理请求使用的 UA（豆瓣封面防盗链等场景），默认 Chrome UA                                                                                                                          |
| `FALLBACK_CORS_PROXY`      | 否  | 豆瓣推荐数据直连被拒时降级使用的 CORS 代理地址                                                                                                                                   |
| `COOKIE_SECURE`            | 否  | 显式覆盖会话 cookie 的 `Secure` 标记；反向代理未正确传递 `x-forwarded-proto` 导致 HTTPS 下登录失效时，设为 `true` 可解                                                                       |
| `DEFAULT_IMAGE_MODE`       | 否  | 图片加载模式（`proxy` / `direct` 等），控制封面是否走代理                                                                                                                       |
| `UPSTREAM_PROXY`           | 否  | 服务端拉取上游时的出口代理地址（如 `http://127.0.0.1:7897`），用于源站需要科学上网的场景                                                                                                     |

> - 面向公众部署时强烈建议填写，否则站点无内容可用。

## 使用说明

### 访客侧

1. **搜索**：首页或顶部搜索框输入片名；结果经服务端聚合、按相关度排序，跨源同名影片合并为一张卡片。
2. **播放**：详情弹窗选择剧集进入 `/watch`；支持快捷键（空格/←→/↑↓/F/Alt+←→）、移动端长按 3 倍速、自动连播。观看时后续分片自动缓存到本地，播放页可「下载本集」离线观看。
3. **进度与历史**：自动保存在本设备 IndexedDB，播放时自动同步最新剧集。
4. **设置**：齿轮入口打开，仅含「偏好设置」（广告切片过滤 / 自动连播 / 片段本地缓存）与「我的账号」（访问状态与版本）两个分组。

### 部署者侧（源配置）

源与订阅**不在访客设置面板里**，全部通过部署环境变量预置：

- **点播源**：`DEFAULT_SOURCES`（Apple CMS 等采集站，格式见上表）
- **数据源订阅**：`DEFAULT_SUBSCRIPTIONS`（一份 JSON 同时含点播源，兼容 TVBOX 配置）

预置的源服务端一次性下发，不写入访客的 localStorage；若首屏 `/api/status` 拉取失败，全站会暂时无源（首页搜索与分类页为空），部署时请确保该接口可达。

## 数据源订阅 / 分享

数据源（点播源）可导出为一份 JSON 托管到公开 URL，他人在部署时填入 `DEFAULT_SUBSCRIPTIONS` 即可订阅。订阅地址直接填 TVBOX 配置也行，服务端按结构自动识别格式。

订阅格式（LibreTV-SourceList JSON）：

```json
{
  "name": "我的源列表",
  "version": 2,
  "sources": [
    { "name": "示例点播源", "url": "https://example.com/api.php/provide/vod", "detail": "https://example.com", "isAdult": false }
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
