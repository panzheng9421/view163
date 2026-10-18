/**
 * 分类窗口取样的公共实现：请求路径与后台预热共用同一套逻辑，
 * 保证「预热写进去的缓存」和「用户请求算出来的」是同一个 key、同一份数据。
 *
 * 窗口模式用于两类筛选：
 * - 排序（hot / score）：源站不支持按评分排序，只能拉最近 N 页本地重排
 * - 地区过滤：源站 area= 参数实测被忽略，只能拉大窗口后本地按归一化标签筛
 * 两者取样结果都与具体排序 / 地区无关（排序与筛选都在本地做），
 * 所以缓存 key 只含 源 + 分类 + 窗口页数 + 成人过滤。
 */
import { cmsRequestHeaders, filterAdultResults, parseSearchList } from './cms-parser';
import { fetchUpstream } from './fetch-utils';
import type { SearchResultItem, SourceConfig } from './types';

/**
 * 单页上游请求超时。环境变量 CATEGORY_PAGE_TIMEOUT_MS 可配，默认 9s。
 * 源站在境外（Cloudflare）时国内机房直连常见 3~15s，部署时可按实测调大（如 20000）。
 */
export const PAGE_TIMEOUT_MS = (() => {
  const n = parseInt(process.env.CATEGORY_PAGE_TIMEOUT_MS || '9000', 10);
  return Number.isFinite(n) && n >= 1000 ? n : 9000;
})();

/** 排序窗口：3 页 = 60 部，足够排首屏 24 条，冷启动快 */
export const SORT_WINDOW_PAGES = 3;
/** 地区窗口：25 页 = 500 部，实测覆盖 AREA_OPTIONS 全部地区 */
export const AREA_WINDOW_PAGES = 25;

/** 窗口缓存 key：源站 base + 分类 + 窗口页数 + 成人过滤（不含 sort / area，见顶部说明） */
export function windowCacheKey(
  base: string,
  t: number,
  windowPages: number,
  filterAdult: boolean
): string {
  return `${base}|${t}|w${windowPages}|${filterAdult}`;
}

/**
 * 窗口内单批并发页数（默认 8，环境变量 CATEGORY_PAGE_BATCH 可配）。
 * 实测 25 页一次全打（50+ 并发）会把源站 / 代理打挂一批页，窗口整体失败；
 * 分批 8 页并发后成功率明显提升，总耗时只略增。
 */
const PAGE_BATCH = (() => {
  const n = parseInt(process.env.CATEGORY_PAGE_BATCH || '8', 10);
  return Number.isFinite(n) && n >= 1 && n <= 25 ? n : 8;
})();

/** 最近失败的页（诊断用：预热没覆盖全时看这里，只保留最近 30 条） */
const pageFailures: string[] = [];
/** 最近一次源站限流（429）的时间：预热据此退避，别再往枪口上撞 */
let lastRateLimitAt = 0;

/** 60 秒内出现过 429 = 源站还在限流，预热应该让路 */
export function hitRateLimit(): boolean {
  return Date.now() - lastRateLimitAt < 60_000;
}

function noteFailure(t: number, pg: number, why: string): void {
  if (why.startsWith('HTTP 429')) lastRateLimitAt = Date.now();
  pageFailures.push(`t${t}/pg${pg}: ${why}`);
  if (pageFailures.length > 30) pageFailures.shift();
}
export function recentPageFailures(): readonly string[] {
  return pageFailures;
}

/** 按分类拉一页上游数据；失败返回 null（窗口取样允许部分页失败），原因记入 recentPageFailures */
export async function fetchPage(
  base: string,
  source: SourceConfig,
  t: number,
  pg: number,
  filterAdult: boolean
): Promise<SearchResultItem[] | null> {
  const url = `${base}?ac=videolist&t=${encodeURIComponent(String(t))}&pg=${pg}`;
  try {
    const res = await fetchUpstream(url, { timeoutMs: PAGE_TIMEOUT_MS, headers: cmsRequestHeaders() });
    if (!res.ok) {
      noteFailure(t, pg, `HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as unknown;
    return filterAdultResults(parseSearchList(data, source), filterAdult);
  } catch (err) {
    noteFailure(t, pg, (err as Error).message);
    return null;
  }
}

/**
 * 每页条数：24 = 1 排 6 卡的整数倍（4 整行，网格不留缺口）。
 * 源站每页硬 20 条（pagesize/limit 实测被忽略），故「最新」直取每次响应
 * 24 条 = 并发拉 2 个源站页合并去重取前 24；窗口模式直接在本地切片。
 */
export const PER_PAGE = 24;

/**
 * 「最新」直取缓存 TTL（默认 10 分钟，环境变量 CATEGORY_DIRECT_TTL_MS 可配）。
 * 与窗口的 30 天不同：「最新」要保新鲜度，但不能像窗口那样一个月不刷。
 */
export const DIRECT_TTL_SEC = (() => {
  const n = parseInt(process.env.CATEGORY_DIRECT_TTL_MS || String(10 * 60 * 1000), 10);
  const ms = Number.isFinite(n) && n >= 60_000 ? n : 10 * 60 * 1000;
  return Math.floor(ms / 1000);
})();

/** 窗口软过期：3 天。过期后仍返回旧窗口（秒开），后台按队列重建 */
export const WINDOW_SOFT_TTL_SEC = 3 * 24 * 60 * 60;

/** 直取缓存 key：与窗口 key 区分开（前缀 direct|） */
export function directCacheKey(base: string, t: number, pg: number, filterAdult: boolean): string {
  return `direct|${base}|${t}|${pg}|${filterAdult}`;
}

export interface DirectPage {
  list: SearchResultItem[];
  /** 前端分页页数（源站页数 ÷ 2） */
  pagecount: number;
  total: number;
}

/**
 * 「最新」直取：并发拉 2 个源站页（2N-1, 2N）合并去重取前 PER_PAGE 条。
 * 这条路径是分类页的**默认排序**（顶栏点「电影/电视剧」进来就是它），
 * 曾经完全没有缓存，每次访问都实时打源站（2.5s+），现已加短 TTL 缓存。
 */
export async function fetchDirectPage(
  base: string,
  source: SourceConfig,
  t: number,
  pg: number,
  filterAdult: boolean
): Promise<DirectPage | null> {
  const pageUrl = (p: number) =>
    `${base}?ac=videolist&t=${encodeURIComponent(String(t))}&pg=${p}`;
  const srcPgA = pg * 2 - 1;
  const srcPgB = pg * 2;
  const [resA, resB] = await Promise.all(
    [srcPgA, srcPgB].map((p) =>
      fetchUpstream(pageUrl(p), { timeoutMs: PAGE_TIMEOUT_MS, headers: cmsRequestHeaders() })
    )
  );
  if (!resA.ok) {
    noteFailure(t, srcPgA, `HTTP ${resA.status}`);
    return null;
  }
  const dataA = (await resA.json()) as { pagecount?: unknown; total?: unknown };
  const rawA = parseSearchList(dataA, source);
  let rawB: SearchResultItem[] = [];
  if (resB.ok) {
    try {
      rawB = parseSearchList((await resB.json()) as unknown, source);
    } catch {
      noteFailure(t, srcPgB, 'parse');
    }
  } else {
    noteFailure(t, srcPgB, `HTTP ${resB.status}`);
  }
  // 合并去重（翻页期间源站新增会导致同一部片出现在相邻页）
  const seen = new Set<string>();
  const merged: SearchResultItem[] = [];
  for (const item of [...rawA, ...rawB]) {
    if (!item.vodId || seen.has(item.vodId)) continue;
    seen.add(item.vodId);
    merged.push(item);
  }
  const srcPagecount = parseInt(String(dataA.pagecount ?? '1'), 10) || 1;
  const total = parseInt(String(dataA.total ?? '0'), 10) || 0;
  return {
    list: filterAdultResults(merged, filterAdult).slice(0, PER_PAGE),
    pagecount: Math.max(1, Math.ceil(srcPagecount / 2)),
    total,
  };
}
export async function buildWindow(
  base: string,
  source: SourceConfig,
  t: number,
  windowPages: number,
  filterAdult: boolean
): Promise<SearchResultItem[] | null> {
  const pages: (SearchResultItem[] | null)[] = [];
  for (let start = 1; start <= windowPages; start += PAGE_BATCH) {
    const end = Math.min(start + PAGE_BATCH - 1, windowPages);
    const batch = await Promise.all(
      Array.from({ length: end - start + 1 }, (_, i) =>
        fetchPage(base, source, t, start + i, filterAdult)
      )
    );
    pages.push(...batch);
  }
  const ok = pages.filter((p): p is SearchResultItem[] => Array.isArray(p));
  if (ok.length === 0) return null;
  const seen = new Set<string>();
  const merged: SearchResultItem[] = [];
  for (const page of ok) {
    for (const item of page) {
      if (!item.vodId || seen.has(item.vodId)) continue;
      seen.add(item.vodId);
      merged.push(item);
    }
  }
  return merged;
}
