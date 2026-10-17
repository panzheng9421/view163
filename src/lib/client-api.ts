'use client';

import type { SearchResponse, SearchStreamEvent, SourceHealthHint, SourceSearchOutcome, VideoDetail, DoubanResponse, BangumiCalendarResponse, AuthStatusResponse, SourceConfig, SearchResultItem, LivePlaylistResponse, LiveEpgResponse, SourceListPayload, CategoryResponse, CategorySort } from './types';

/**
 * 客户端 API 封装。401 时触发全局事件打开登录框，
 * 替代旧版在每个函数里手工检查 isPasswordVerified 的散弹式写法。
 */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const UNAUTHORIZED_EVENT = 'libretv:unauthorized';

/** 单条测活结果（/api/live/probe，JSON 与 NDJSON 流共用同一结构） */
export interface LiveProbeResult {
  url: string;
  ok: boolean;
  status?: number;
  /** 分片级探测：仅统计分片往返耗时 */
  ms?: number;
  /** segment=分片级（最可信）/ manifest=仅列表可达 / head=直链单级 */
  level?: 'segment' | 'manifest' | 'head';
  error?: string;
  /** master playlist 的 CODECS，用于前端提示 H.265 等不可解码情况 */
  codec?: string;
  /** 因超时失败：源可能只是慢，前端以琥珀色区分于真正的不可达 */
  timedOut?: boolean;
  /** 分片吞吐估算（kbps）：低于阈值的源前端标记为「源限速」 */
  kbps?: number;
}

/** /api/status 的 React Query key：Providers 与 AuthProvider 共用，避免同一页面重复请求 */
export const STATUS_QUERY_KEY = ['app-status'] as const;

export function onUnauthorized(handler: (event: CustomEvent) => void): () => void {
  const wrapped = (e: Event) => handler(e as CustomEvent);
  window.addEventListener(UNAUTHORIZED_EVENT, wrapped);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, wrapped);
}

/** 401/503 统一处理：分发全局事件打开登录框并抛 ApiError（普通与流式请求共用） */
function throwForAuthStatus(res: Response): void {
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    throw new ApiError('需要登录', 401);
  }
  if (res.status === 503) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: 'setup' }));
    throw new ApiError('服务器未配置密码', 503);
  }
}

/** NDJSON 流读取：按行解析 JSON 并回调，坏行跳过不影响其余结果 */
async function consumeNdjson<T>(res: Response, onEvent: (event: T) => void): Promise<void> {
  if (!res.body) throw new ApiError(`请求失败 (${res.status})`, res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const consume = (line: string) => {
    const text = line.trim();
    if (!text) return;
    try {
      onEvent(JSON.parse(text) as T);
    } catch {
      // 坏行跳过，不影响其余结果
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      consume(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }
  buffer += decoder.decode();
  consume(buffer);
}

/**
 * 通用 JSON 请求。
 *
 * 默认 20s 超时（调用方传了 signal 时与之合并）：
 * dev 编译中 / 服务重启 / 代理挂起时，无超时的 fetch 会无限挂起，
 * 导致 statusQuery 永远 isLoading，分类页卡死在「正在准备片源…」。
 * 注意：仅用于一次性 JSON 接口；流式（/api/search?stream=1）不走这里。
 */
async function request<T>(url: string, init?: RequestInit, timeoutMs = 20_000): Promise<T> {
  let res: Response;
  const signal = init?.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  try {
    res = await fetch(url, { ...init, signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('网络请求失败，请检查网络连接', 0);
  }
  throwForAuthStatus(res);
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) msg = data.error;
    } catch { /* 忽略解析失败 */ }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

/**
 * 拉取 /api/status，带手写退避重试。
 *
 * 为什么必须重试：dev 首次编译、服务刚重启、代理刚启动这类瞬时失败很常见，
 * 而这一拉的失败代价极大——预置源（envSources）只由本接口下发、不落 localStorage，
 * 一次失败就会让整场会话「一个源都没有」，首页搜索与顶栏分类入口全部空掉。
 *
 * 为什么重试写在 queryFn 内部而不是用 React Query 的 retry：
 * 多个 observer 共享同一 query key（Providers / AuthProvider / 分类页）时，
 * 框架层的 retry 实测会被吞掉（掐断头两次请求后就不再重试，直接进 error 态）。
 */
export async function fetchStatusWithRetry(attempts = 5): Promise<AuthStatusResponse> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await request<AuthStatusResponse>('/api/status');
    } catch (err) {
      // 主动取消（切页/卸载）不重试，直接冒泡
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, Math.min(800 * 2 ** i, 4000)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new ApiError('状态接口不可用', 0);
}

export const api = {
  status: () => request<AuthStatusResponse>('/api/status'),

  login: (password: string) =>
    request<{ success: boolean }>('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }),

  logout: () => request<{ success: boolean }>('/api/auth', { method: 'DELETE' }),

  /**
   * 聚合搜索。传入 onSource 时走 /api/search?stream=1 的 NDJSON 流：
   * 每个源结算立即回调（健康源结果不再等坏源超时），最终以聚合结果 resolve。
   * 未传 onSource 或流不可用时回退为一次性 JSON 请求。
   */
  search: async (
    wd: string,
    sources: SourceConfig[],
    filterAdult: boolean,
    opts?: {
      signal?: AbortSignal;
      onSource?: (outcome: SourceSearchOutcome) => void;
      /** 各源健康度摘要（按 sourceKey）：成功提权、连败降权，仅影响排序，不踢出任何源 */
      health?: Record<string, SourceHealthHint>;
    }
  ): Promise<SearchResponse> => {
    const signal = opts?.signal;
    const onSource = opts?.onSource;
    const health = opts?.health;
    if (!onSource) {
      return request<SearchResponse>('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wd, sources, filterAdult, health }),
        signal,
      });
    }
    return searchStream(wd, sources, filterAdult, onSource, signal, health);
  },

  detail: (id: string, source: SourceConfig, signal?: AbortSignal) => {
    const sp = new URLSearchParams({ id, source: JSON.stringify(source) });
    return request<VideoDetail>(`/api/detail?${sp.toString()}`, { signal });
  },

  douban: (type: 'movie' | 'tv', tag: string, pageStart: number, pageSize: number, signal?: AbortSignal) => {
    const sp = new URLSearchParams({ type, tag, pageStart: String(pageStart), pageSize: String(pageSize) });
    return request<DoubanResponse>(`/api/douban?${sp.toString()}`, { signal });
  },

  /** Bangumi 每日放送（免 key），首页推荐的另一数据源 */
  bangumiCalendar: (signal?: AbortSignal) => request<BangumiCalendarResponse>('/api/bangumi/calendar', { signal }),

  /** 影视热榜（60s API 免 key）：豆瓣周榜五个类目 + 百度热播剧 */
  hotList: (id: string, signal?: AbortSignal, page?: { start: number; count: number }) => {
    const sp = new URLSearchParams({ id });
    if (page) {
      sp.set('start', String(page.start));
      sp.set('count', String(page.count));
    }
    return request<DoubanResponse>(`/api/hot-list?${sp.toString()}`, { signal });
  },

  /** 分类浏览（单源 t= 拉片单，支持分页 + 地区过滤 + 排序）：顶栏一级分类入口使用 */
  category: (
    source: SourceConfig,
    t: number,
    pg: number,
    sort: CategorySort = 'new',
    area = 'all',
    filterAdult = true,
    signal?: AbortSignal
  ) =>
    request<CategoryResponse>('/api/category', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, t, pg, sort, area, filterAdult }),
      signal,
    }),

  /** 换源：按标题跨源搜索并取详情，附带接口耗时（测速）；支持 signal 以便关闭弹窗时中止在途请求 */
  detailSpeed: async (id: string, source: SourceConfig, signal?: AbortSignal) => {
    const start = performance.now();
    try {
      const detail = await api.detail(id, source, signal);
      return { ok: true, ms: Math.round(performance.now() - start), detail };
    } catch (err) {
      return { ok: false, ms: Math.round(performance.now() - start), detail: undefined as VideoDetail | undefined, error: err instanceof Error ? err.message : '失败' };
    }
  },

  /** 点播源探活：以搜索 "test" 的耗时与结果量衡量可用性 */
  testSource: (url: string) =>
    request<{ ok: boolean; ms: number; count?: number; error?: string }>('/api/source/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }),

  /** 拉取远程数据源订阅（自动识别 LibreTV-SourceList JSON 与 TVBOX 配置 JSON） */
  fetchSourceList: (url: string) => {
    const sp = new URLSearchParams({ url });
    return request<SourceListPayload>(`/api/source-list?${sp.toString()}`);
  },

  /** 把源列表发布到公开粘贴板换回订阅链接（走服务端代理：绕开 CORS，且目标域名固定不可控） */
  publishSourceList: (payload: {
    name?: string;
    sources: { name: string; url: string }[];
    liveSources: { name: string; url: string; epg?: string }[];
  }) =>
    request<{ url: string; provider: string; sources: number; liveSources: number }>('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  /** —— 直播 / IPTV —— */

  /** 拉取并解析 M3U 订阅；force=1 跳过服务端缓存 */
  livePlaylist: (url: string, force = false, signal?: AbortSignal) => {
    const sp = new URLSearchParams({ url });
    if (force) sp.set('force', '1');
    return request<LivePlaylistResponse>(`/api/live/playlist?${sp.toString()}`, { signal });
  },

  /** 查询某频道的节目单（服务端缓存 6h） */
  liveEpg: (epgUrl: string, tvgId: string, force = false, signal?: AbortSignal) => {
    const sp = new URLSearchParams({ url: epgUrl, channel: tvgId });
    if (force) sp.set('force', '1');
    return request<LiveEpgResponse>(`/api/live/epg?${sp.toString()}`, { signal });
  },

  /** 直播订阅探活：以拉取解析耗时与频道数衡量可用性 */
  liveTest: async (url: string) => {
    const start = performance.now();
    try {
      const playlist = await api.livePlaylist(url, true);
      return { ok: true, ms: Math.round(performance.now() - start), count: playlist.channels.length, error: undefined as string | undefined };
    } catch (err) {
      return { ok: false, ms: Math.round(performance.now() - start), count: 0, error: err instanceof Error ? err.message : '失败' };
    }
  },

  /** 订阅导出（.m3u）下载地址 */
  liveExportUrl: (url: string) => {
    const sp = new URLSearchParams({ url, format: 'm3u' });
    return `/api/live/playlist?${sp.toString()}`;
  },

  /** 批量测活：分片级探测频道可达性与延迟（单批最多 50 条） */
  liveProbe: (urls: string[], signal?: AbortSignal) =>
    request<{ results: LiveProbeResult[] }>(
      '/api/live/probe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
        signal,
      }
    ),

  /**
   * 流式测活：服务端以 NDJSON 逐条推送（命中缓存的立即返回），
   * 结果边测边回调，列表状态点可以边测边亮。
   */
  liveProbeStream: async (
    urls: string[],
    onResult: (result: LiveProbeResult) => void,
    signal?: AbortSignal
  ): Promise<void> => {
    const res = await fetch('/api/live/probe?stream=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
      signal,
    });
    throwForAuthStatus(res);
    if (!res.ok || !res.body) throw new ApiError(`请求失败 (${res.status})`, res.status);

    await consumeNdjson<LiveProbeResult>(res, onResult);
  },
};

export interface SearchFailure {
  sourceKey: string;
  error: string;
  timedOut?: boolean;
}

/** 聚合搜索流式消费：逐源回调 + 最终聚合结果（NDJSON 行协议，同 liveProbeStream） */
async function searchStream(
  wd: string,
  sources: SourceConfig[],
  filterAdult: boolean,
  onSource: (outcome: SourceSearchOutcome) => void,
  signal?: AbortSignal,
  health?: Record<string, SourceHealthHint>
): Promise<SearchResponse> {
  const res = await fetch('/api/search?stream=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wd, sources, filterAdult, health }),
    signal,
  });
    throwForAuthStatus(res);
    if (!res.ok || !res.body) throw new ApiError(`请求失败 (${res.status})`, res.status);

    // done 事件缺失（流被截断）时退化为空结果，不让整次搜索报错
    let final: SearchResponse = { list: [], failures: [] };
    await consumeNdjson<SearchStreamEvent>(res, (event) => {
      if (event.type === 'source') {
        onSource(event);
      } else if (event.type === 'done') {
        final = { list: event.list, failures: event.failures };
      }
    });
    return final;
  }

export type { SearchResponse, SearchResultItem };
