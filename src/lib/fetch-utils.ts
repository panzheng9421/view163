/** 服务端上游请求工具：超时、重试、安全跳转、JSON 解析 */

import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { checkLiveUrlAllowed, checkUpstreamAllowed } from './ssrf';

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  /**
   * 安全跳转（默认开启）：禁用 fetch 的自动跟随，改为手动逐跳跟随，
   * 每一跳重新执行 SSRF 校验——否则公网 URL 可 302 跳转到内网地址绕过预检。
   */
  safeRedirects?: boolean;
  /**
   * 直播场景放行内网地址（自建 IPTV）：仅在部署者设置 LIVE_ALLOW_PRIVATE=1 时生效。
   * 校验复用 checkLiveUrlAllowed，与直播流代理使用同一把尺子。
   */
  allowPrivate?: boolean;
  /**
   * 绕过 UPSTREAM_PROXY 直连。
   * 视频 CDN（m3u8/ts/key）在国内、且普遍拒绝代理出口 IP（实测经代理返回 403、
   * 直连 200），而 UPSTREAM_PROXY 存在的意义是让源站 API 过 Cloudflare——
   * 两者方向相反，媒体链路必须能单独走直连。
   */
  noProxy?: boolean;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECT_HOPS = 5;

/**
 * 可选出网代理：Node 原生 fetch 不读系统代理，本地/VPN 环境下直连海外源站易超时。
 * 设了 UPSTREAM_PROXY（如 http://127.0.0.1:7897）就把上游请求改走代理；
 * 不设则完全保持原生 fetch 行为（云服务器直连正常的环境无需此变量）。
 */
const UPSTREAM_PROXY = (process.env.UPSTREAM_PROXY || '').trim();
const proxyDispatcher = UPSTREAM_PROXY ? new ProxyAgent(UPSTREAM_PROXY) : null;

/** 统一出网入口：配了代理走代理，未配走原生 fetch */
const upstreamFetch: typeof fetch = proxyDispatcher
  ? ((input: RequestInfo | URL, init?: RequestInit) =>
      undiciFetch(input as string, {
        ...init,
        dispatcher: proxyDispatcher,
      } as never) as unknown as Promise<Response>)
  : fetch;

/** 是否配置了 UPSTREAM_PROXY：调用方可据此决定「直连优先、代理兜底」的双路策略 */
export const hasUpstreamProxy = Boolean(proxyDispatcher);

/**
 * 站内采集反代：容器里的 Node(undici) 直连源站会被 Cloudflare 按 TLS 指纹拦截
 * （curl/nginx 的 OpenSSL 指纹能过、Node 秒级 fetch failed）。
 * 设了 INGEST_PROXY_BASE（如 http://host.docker.internal:18080，指向宿主机 nginx 的
 * /__proxy/ 反代口）时，把采集接口请求改走本机——由 nginx 用 OpenSSL 指纹去拉源站。
 *
 * 只改写 `api.php` 采集接口：媒体 m3u8/ts 必须保持原样（CDN 拒代理出口且无需伪装指纹）。
 * 源配置里的域名不变，因此分类体系（按源域名匹配）与前端展示完全不受影响。
 */
const INGEST_PROXY_BASE = (process.env.INGEST_PROXY_BASE || '').trim().replace(/\/+$/, '');

function toIngestProxy(url: string): string {
  if (!INGEST_PROXY_BASE) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (!u.pathname.includes('/api.php')) return url;
  return `${INGEST_PROXY_BASE}/__proxy/${u.hostname}${u.pathname}${u.search}`;
}

function isIngestProxyUrl(url: string): boolean {
  return Boolean(INGEST_PROXY_BASE) && url.startsWith(`${INGEST_PROXY_BASE}/__proxy/`);
}

/**
 * 采集源 SSRF 预检：当请求实际由本机代理带出时（INGEST 反代 或 UPSTREAM_PROXY 全局代理），
 * 容器自身 DNS 解析结果无意义（实测 360zy.com 被解析成 2003::f11 这类保留地址而误杀），
 * 此时不该按容器本地解析把好源误杀，直接放行；两者都未启用时照旧严格校验。
 */
export async function checkUpstreamOrIngest(url: string): Promise<{ ok: boolean; reason?: string }> {
  if (toIngestProxy(url) !== url || hasUpstreamProxy) return { ok: true };
  return checkUpstreamAllowed(url);
}

/** 按方向选出网方式：noProxy 时强制直连，忽略 UPSTREAM_PROXY */
const pickFetch = (noProxy: boolean): typeof fetch =>
  noProxy && proxyDispatcher ? fetch : upstreamFetch;

export interface FetchResult {
  res: Response;
  /** 跟随重定向后的最终 URL（manual 模式下 res.url 不可靠，须自行跟踪）。
   *  解析 manifest 内的相对地址必须用它，否则分片路径会指向错误目录。 */
  finalUrl: string;
}

export interface SafeRedirectOptions {
  /**
   * 直播场景放行内网地址（自建 IPTV）：仅在部署者设置 LIVE_ALLOW_PRIVATE=1 时生效。
   * 校验复用 checkLiveUrlAllowed，与直播流代理使用同一把尺子。
   */
  allowPrivate?: boolean;
  /**
   * 仅对「响应头等待」限时（直播流专用）：对整个 body 限时会切断
   * HTTP-FLV 单一无限长连接，故拿到响应头后立即清除计时器，body 不再受限。
   * 超时触发即整链失败（内部 controller 已 abort，对齐直播路由原行为）。
   */
  headerTimeoutMs?: number;
  /** 绕过 UPSTREAM_PROXY 直连（每一跳都直连），用于媒体 CDN 拒绝代理出口的场景 */
  noProxy?: boolean;
}

/**
 * 手动逐跳跟随重定向，每一跳重新执行 SSRF 校验。
 * 不能用 redirect:'follow'——预检之后 fetch 自动跟随的 3xx 可把请求
 * 带进内网/元数据地址，绕过对首跳的校验。
 */
export async function fetchWithSafeRedirects(
  url: string,
  init: Omit<RequestInit, 'redirect'> = {},
  options: SafeRedirectOptions = {}
): Promise<FetchResult> {
  const { allowPrivate = false, headerTimeoutMs, noProxy = false } = options;
  const doFetch = pickFetch(noProxy);
  let current = url;
  // headerTimeout 超时即 abort 内部 controller；外部 signal（调用方死线/客户端断开）链入同一 controller
  const controller = new AbortController();
  if (init.signal) {
    if (init.signal.aborted) controller.abort(init.signal.reason);
    else init.signal.addEventListener('abort', () => controller.abort(init.signal?.reason), { once: true });
  }
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    // 采集接口改走本机反代（见 INGEST_PROXY_BASE 说明）；其他地址原样直连
    const target = toIngestProxy(current);
    const verdict: { ok: boolean; reason?: string } = isIngestProxyUrl(target)
      ? { ok: true }
      : allowPrivate
        ? await checkLiveUrlAllowed(target)
        : await checkUpstreamAllowed(target);
    if (!verdict.ok) {
      throw new Error(`跳转目标被拒绝: ${verdict.reason}`);
    }
    const timer = headerTimeoutMs ? setTimeout(() => controller.abort(), headerTimeoutMs) : null;
    let res: Response;
    try {
      res = await doFetch(target, { ...init, signal: controller.signal, redirect: 'manual' });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!REDIRECT_STATUSES.has(res.status)) return { res, finalUrl: current };
    const location = res.headers.get('location');
    if (!location) return { res, finalUrl: current };
    current = new URL(location, current).href;
  }
  throw new Error('重定向次数过多');
}

export async function fetchUpstream(url: string, options: FetchOptions = {}): Promise<Response> {
  return (await fetchUpstreamWithMeta(url, options)).res;
}

/** 同 fetchUpstream，额外返回重定向后的最终 URL */
export async function fetchUpstreamWithMeta(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const {
    timeoutMs = 8000,
    retries = 0,
    safeRedirects = true,
    allowPrivate = false,
    noProxy = false,
    ...init
  } = options;
  // 外部 signal（调用方的总死线中断）与单次超时合并：任一触发即中断请求
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  // 走采集反代时默认多试一次：nginx 解析到的 CF 边缘 IP 偶有握手 RST/超时，
  // 换个 IP 重试命中率明显提升（10 源并发时尤其明显）。
  const ingestTarget = toIngestProxy(url) !== url;
  const effectiveRetries = retries > 0 ? retries : ingestTarget ? 1 : 0;
  let lastError: unknown;
  for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
    try {
      if (!safeRedirects) {
        const res = await pickFetch(noProxy)(toIngestProxy(url), {
          ...init,
          signal,
          redirect: init.redirect ?? 'follow',
        });
        return { res, finalUrl: res.url || url };
      }
      // 手动逐跳跟随，每一跳重新过 SSRF 校验
      return await fetchWithSafeRedirects(url, { ...init, signal }, { allowPrivate, noProxy });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('上游请求失败');
}

export async function fetchUpstreamJson<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
  const res = await fetchUpstream(url, options);
  if (!res.ok) throw new Error(`上游请求失败: ${res.status}`);
  const data = (await res.json()) as T;
  return data;
}

// 进程内存缓存已移除：所有服务端缓存统一走 Redis（lib/category-cache.ts）。
// 原因：内存 Map 无按字节封顶，搜索结果这类大 payload 堆积会顶高进程内存；
// 且进程重启即丢。新代码请用 cacheGetJson / cacheSetJson。
