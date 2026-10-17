// 采集站（Apple CMS 资源站）描述
export interface SourceConfig {
  /** 唯一标识，如 "custom_0"；内置源直接用短名 */
  key: string;
  name: string;
  /** API 根地址，如 https://example.com/api.php/provide/vod */
  url: string;
  /** 可选：详情页根地址（部分源需要爬详情页提取 m3u8） */
  detail?: string;
  isAdult?: boolean;
}

/**
 * 前端传给后端的「源健康度摘要」：只带排序所需的最小信息。
 * 单独定义而不复用 store 的 SourceHealthEntry，是为了不让后端反向依赖客户端 store。
 */
export interface SourceHealthHint {
  /** 上次搜索是否成功 */
  ok: boolean;
  /** 连续失败/超时次数；成功时为 0 */
  failStreak: number;
  /** 上次响应耗时（毫秒），仅成功时有意义 */
  ms?: number;
}

export interface SearchResultItem {
  sourceKey: string;
  sourceName: string;
  vodId: string;
  name: string;
  pic?: string;
  typeName?: string;
  year?: string;
  area?: string;
  remarks?: string;
  /** 自定义源的 API 地址，详情请求需要 */
  sourceUrl?: string;
  isAdult?: boolean;
  /** 源站播放量（部分源返回，用于「最热」排序） */
  hits?: number;
  /** 源站评分（部分源返回，用于「高分好评」排序） */
  score?: number;
  /** 主演列表（逗号分隔原文，如「梁洛施 , 文俊辉 , 洪金宝」） */
  actor?: string;
  /** 导演 */
  director?: string;
}

export interface VideoInfo {
  title?: string;
  cover?: string;
  desc?: string;
  typeName?: string;
  year?: string;
  area?: string;
  director?: string;
  actor?: string;
  remarks?: string;
  sourceKey: string;
  sourceName: string;
  sourceUrl?: string;
}

export interface VideoDetail {
  episodes: string[];
  videoInfo: VideoInfo;
}

export interface DoubanItem {
  id: string;
  title: string;
  cover: string;
  rating?: string;
  isTv?: boolean;
}

export interface SourceSearchOutcome {
  sourceKey: string;
  ok: boolean;
  list: SearchResultItem[];
  error?: string;
  /** 因超时失败：源可能只是慢，前端以琥珀色区分于真正的失败 */
  timedOut?: boolean;
  /** 该源搜索总耗时（ms），用于健康徽章 */
  ms?: number;
}

// —— API 响应结构 ——

export interface SearchResponse {
  list: SearchResultItem[];
  failures: { sourceKey: string; error: string; timedOut?: boolean }[];
}

/** 一级分类的中文标签（顶栏平铺的四个入口） */
export type CategoryKey = '电影' | '电视剧' | '综艺' | '动漫';

/**
 * 分类页排序方式。
 * - `new`：源站默认顺序（bfzy 实测即按更新时间倒序），全量分页
 * - `hot`：按播放量 vod_hits 降序
 * - `score`：按评分 vod_score 降序
 *
 * 注意：bfzy（以及多数采集站）**不支持**服务端排序参数（by=/order= 实测被忽略），
 * 因此 hot/score 由后端拉取「最近更新的若干页」合并后按真实字段排序，
 * 属于「近期热门/近期高分」，覆盖范围天然小于 new 的全量。
 */
export type CategorySort = 'new' | 'hot' | 'score';

/** /api/category 单源分类浏览响应 */
export interface CategoryResponse {
  list: SearchResultItem[];
  page: number;
  pagecount: number;
  total: number;
  /** 本次结果使用的排序方式 */
  sort?: CategorySort;
}

/** /api/search?stream=1 的 NDJSON 事件：逐源推送 + 最终聚合 */
export type SearchStreamEvent =
  | ({ type: 'source' } & SourceSearchOutcome)
  | { type: 'done'; list: SearchResultItem[]; failures: SearchResponse['failures'] };

export interface DoubanResponse {
  items: DoubanItem[];
  /** 分页模式下返回：榜单总条数（全部页「查看更多」判断是否还有更多） */
  total?: number;
}

export interface BangumiCalendarDay {
  /** 1=周一 … 7=周日 */
  weekday: number;
  items: DoubanItem[];
}

export interface BangumiCalendarResponse {
  days: BangumiCalendarDay[];
}

export interface AuthStatusResponse {
  /** 服务器是否配置了 PASSWORD */
  passwordRequired: boolean;
  /** 当前会话是否已验证 */
  verified: boolean;
  /** 鉴权是否被 DISABLE_AUTH 关闭（二开自用模式），前端据此跳过登录框 */
  authDisabled?: boolean;
  version: string;
  /** 部署者通过 DEFAULT_SOURCES 环境变量预置的采集站（未配置时为空数组） */
  defaultSources: SourceConfig[];
  /** 部署者通过 DEFAULT_LIVE_SOURCES 环境变量预置的直播源（未配置时为空数组） */
  defaultLiveSources: LiveSourceConfig[];
  /** 部署者通过 DEFAULT_SUBSCRIPTIONS 环境变量预置的 SourceList 订阅链接（未配置时为空数组） */
  defaultSubscriptions: { url: string; name?: string }[];
  /** 部署者通过 DEFAULT_RECOMMEND_SOURCE 环境变量指定的首页推荐数据源默认值（未配置时为 null） */
  defaultRecommendSource: 'douban' | 'bangumi' | 'hot-list' | null;
  /** 部署者通过 DEFAULT_IMAGE_MODE 环境变量指定的封面图加载方式默认值（未配置时为 null） */
  defaultImageMode: 'direct' | 'proxy' | null;
}

// —— 直播 / IPTV ——

/** 直播源（M3U 订阅）配置 */
export interface LiveSourceConfig {
  key: string;
  name: string;
  /** M3U 订阅地址 */
  url: string;
  /** 可选：XMLTV 节目单地址 */
  epg?: string;
}

/** 单个直播频道（由 M3U 解析得到） */
export interface LiveChannel {
  /** tvg-id 优先，缺失时由 URL 生成的稳定短 id */
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  /** M3U 的 tvg-name 属性（原始台名） */
  rawName?: string;
}

export interface LivePlaylistResponse {
  /** 订阅名（M3U 无名时为空） */
  name?: string;
  channels: LiveChannel[];
  groups: string[];
}

/** 单条节目单条目（XMLTV programme） */
export interface EpgProgram {
  channelId: string;
  /** epoch ms */
  start: number;
  /** epoch ms */
  stop: number;
  title: string;
  desc?: string;
}

export interface LiveEpgResponse {
  channelId: string;
  current?: EpgProgram;
  next?: EpgProgram;
  programs: EpgProgram[];
}

// —— 数据源订阅 ——

/** 订阅条目未被导入（跳过）的原因分类 */
export type SubscriptionSkipReason =
  /** Spider 类站点（csp_* / jar / js / py），需 TVBOX 引擎才能运行 */
  | 'spider'
  /** 仅提供 XML 接口或不支持的类型 */
  | 'xml'
  /** 站点自身标记为不可搜索（本站只有搜索入口，导入后无法使用） */
  | 'unsearchable'
  /** 直播源不是 M3U 播放列表（如 txt 频道列表、单仓 JSON） */
  | 'nonM3uLive'
  /** 地址非法、非 http(s) 或未通过服务端公网校验 */
  | 'invalidUrl';

/** 订阅解析统计：说明跳过与截断情况，用于导入结果提示 */
export interface SubscriptionParseStats {
  /** 识别出的订阅格式 */
  format: 'libretv' | 'tvbox';
  /** 被跳过的条目总数 */
  skipped: number;
  /** 跳过原因分类计数 */
  skippedByReason: Partial<Record<SubscriptionSkipReason, number>>;
  /** 被跳过条目的名称示例（最多 3 个），便于用户定位 */
  skippedSamples?: string[];
  /** 因超出数量上限被截断的条目数 */
  truncated: number;
}

/**
 * 远程订阅解析结果。
 * `sources` 为点播源（Apple CMS 采集站），`liveSources` 为直播源（M3U + 可选 EPG）。
 * 兼容两种订阅格式：LibreTV-SourceList JSON 与 TVBOX 配置 JSON（`sites` / `lives`）。
 * 老格式订阅只有 `sources`，此时 `liveSources` 为空数组。
 */
export interface SourceListPayload {
  /** 订阅列表自带名称 */
  name?: string;
  sources: Omit<SourceConfig, 'key'>[];
  liveSources: Omit<LiveSourceConfig, 'key'>[];
  /** 解析统计（格式、跳过与截断），老数据可能缺失 */
  stats?: SubscriptionParseStats;
}
