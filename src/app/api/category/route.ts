import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { cmsRequestHeaders, filterAdultResults, parseSearchList, resolveAdultFilter } from '@/lib/cms-parser';
import { checkUpstreamOrIngest, fetchUpstream } from '@/lib/fetch-utils';
import type { CategorySort, SearchResultItem, SourceConfig } from '@/lib/types';

export const runtime = 'nodejs';

interface CategoryBody {
  source: SourceConfig;
  /** Apple CMS 分类 type_id（t= 参数） */
  t: number;
  pg?: number;
  sort?: CategorySort;
  /** 地区筛选标签（见前端 AREA_OPTIONS），'all' / 空 = 不过滤。源站 area= 参数实测被忽略，只能本地筛 */
  area?: string;
  filterAdult?: boolean;
}

/**
 * 每页条数：24 = 1 排 6 卡的整数倍（4 整行，网格不留缺口）。
 * 源站每页硬 20 条（pagesize/limit 实测被忽略），故「最新」直取模式每次响应
 * 24 条 = 并发拉 2 个源站页合并去重取前 24；窗口模式直接在本地切片。
 */
const PER_PAGE = 24;

/** 前端最大页数：直取 126 页（=252 源站页 ÷ 2）+ 余量 */
const MAX_PG = 200;

/**
 * 单页上游请求超时。环境变量 CATEGORY_PAGE_TIMEOUT_MS 可配，默认 9s。
 * 源站在境外（Cloudflare）时国内机房直连常见 3~15s，默认值容易整批超时，
 * 部署时可按实测调大（如 20000）。
 */
const PAGE_TIMEOUT_MS = (() => {
  const n = parseInt(process.env.CATEGORY_PAGE_TIMEOUT_MS || '9000', 10);
  return Number.isFinite(n) && n >= 1000 ? n : 9000;
})();

/**
 * 取样窗口页数：
 * - SORT_WINDOW_PAGES：hot/score 排序取样（最近更新的 100 部，够排）
 * - AREA_WINDOW_PAGES：地区过滤取样（最近更新的 500 部，实测覆盖主要地区；
 *   并发 25 页约 9 秒，冷启动可接受，且结果进长期缓存（默认 30 天）基本只算一次）
 */
// 排序窗口从 5 页降到 3 页（60 部）：足够排首屏 24 条，冷启动更快；
// 配合下方「窗口预热」后用户几乎永远命中缓存。
const SORT_WINDOW_PAGES = 3;
const AREA_WINDOW_PAGES = 25;

/**
 * 窗口结果缓存。分类榜单（评分 / 热度 / 地区筛选）源站数据变化极慢，
 * 不像首页实时榜单需要分钟级新鲜度，故默认缓存 30 天，用「后台预热」代替用户触发的冷启动。
 * 环境变量 CATEGORY_WINDOW_TTL_MS 可配（毫秒）；想回到分钟级新鲜度设小即可。
 * 缓存条目按 LRU 淘汰，上限 CATEGORY_WINDOW_CACHE_MAX（默认 200），防止长 TTL 下内存无限增长。
 */
const WINDOW_TTL_MS = (() => {
  const n = parseInt(process.env.CATEGORY_WINDOW_TTL_MS || String(30 * 24 * 60 * 60 * 1000), 10);
  return Number.isFinite(n) && n >= 1000 ? n : 30 * 24 * 60 * 60 * 1000;
})();
const WINDOW_CACHE_MAX = (() => {
  const n = parseInt(process.env.CATEGORY_WINDOW_CACHE_MAX || '200', 10);
  return Number.isFinite(n) && n >= 20 ? n : 200;
})();

/**
 * 窗口缓存（LRU）。Map 保持插入顺序：命中时先删再插 = 移到末尾；
 * 超限时从头部（最久未用）开始淘汰。
 */
const windowCache = new Map<string, { ts: number; items: SearchResultItem[] }>();

function windowCacheGet(key: string): SearchResultItem[] | null {
  const hit = windowCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts >= WINDOW_TTL_MS) {
    windowCache.delete(key);
    return null;
  }
  // LRU：重新插入把它移到末尾
  windowCache.delete(key);
  windowCache.set(key, hit);
  return hit.items;
}

function windowCacheSet(key: string, items: SearchResultItem[]): void {
  windowCache.delete(key);
  windowCache.set(key, { ts: Date.now(), items });
  while (windowCache.size > WINDOW_CACHE_MAX) {
    const oldest = windowCache.keys().next();
    if (oldest.done) break;
    windowCache.delete(oldest.value);
  }
}

/**
 * 窗口预热：高频「评分 / 播放量」排序组合在后台持续刷新，保证缓存常驻。
 * 用户首次进入分类页（尤其是「高分好评」这类窗口模式）直接命中缓存，
 * 首屏从「冷启动并发拉 N 页（2s+）」降到「命中缓存（<50ms）」。
 * 缓存 TTL 现在默认 30 天，刷新只为了让数据保持「日级新鲜」并覆盖冷门分类首次访问，
 * 周期默认 6 小时（环境变量 CATEGORY_WARM_INTERVAL_MS 可配，毫秒），远小于 TTL。
 */
const WARM_SOURCE: SourceConfig = {
  key: 'env_0',
  name: '暴风资源',
  url: 'https://bfzyapi.com/api.php/provide/vod',
  detail: 'https://bfzyapi.com',
  isAdult: false,
};
// 电影各二级子类的 type_id（与 categories.ts 的 bfzy 映射一致）
const WARM_T = [21, 22, 23, 24, 25, 26, 27, 28, 51];
const WARM_SORTS = ['score', 'hot'] as const;
/** 预热周期，默认 6 小时（远小于 30 天 TTL，只做日级保鲜与冷门分类覆盖） */
const WARM_INTERVAL_MS = (() => {
  const n = parseInt(process.env.CATEGORY_WARM_INTERVAL_MS || String(6 * 60 * 60 * 1000), 10);
  return Number.isFinite(n) && n >= 60_000 ? n : 6 * 60 * 60 * 1000;
})();

async function refreshWindow(t: number, sort: 'score' | 'hot'): Promise<void> {
  const base = WARM_SOURCE.url.replace(/\/+$/, '');
  const windowPages = SORT_WINDOW_PAGES;
  const cacheKey = `${base}|${t}|w${windowPages}|true`;
  try {
    const items = await buildWindow(base, WARM_SOURCE, t, windowPages, true);
    if (items) windowCacheSet(cacheKey, items);
  } catch {
    // 预热失败不影响线上请求，下次周期再试
  }
}

const warmupStarted = (globalThis as { __catWarmup?: boolean }).__catWarmup;
if (!warmupStarted) {
  (globalThis as { __catWarmup?: boolean }).__catWarmup = true;
  const tick = () => {
    for (const t of WARM_T) {
      for (const s of WARM_SORTS) void refreshWindow(t, s);
    }
  };
  tick(); // 启动即预热一轮，避免首访冷启动
  setInterval(tick, WARM_INTERVAL_MS);
}

/** 按分类 + 排序拉一页上游数据；失败返回 null（窗口取样允许部分页失败） */
async function fetchPage(
  base: string,
  source: SourceConfig,
  t: number,
  pg: number,
  filterAdult: boolean
): Promise<SearchResultItem[] | null> {
  const url = `${base}?ac=videolist&t=${encodeURIComponent(String(t))}&pg=${pg}`;
  try {
    const res = await fetchUpstream(url, { timeoutMs: PAGE_TIMEOUT_MS, headers: cmsRequestHeaders() });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    return filterAdultResults(parseSearchList(data, source), filterAdult);
  } catch {
    return null;
  }
}

/**
 * 按分类 + 窗口页数并发拉源站页，合并去重后返回（窗口取样核心逻辑，供请求与预热共用）。
 * 允许部分页失败（窗口取样不要求全页成功）。
 */
async function buildWindow(
  base: string,
  source: SourceConfig,
  t: number,
  windowPages: number,
  filterAdult: boolean
): Promise<SearchResultItem[] | null> {
  const pages = await Promise.all(
    Array.from({ length: windowPages }, (_, i) => fetchPage(base, source, t, i + 1, filterAdult))
  );
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

/**
 * 把源站脏乱的 vod_area 归一化成标准地区标签。
 *
 * 源站值域问题（实测）：
 * - 大陆 / 中国大陆 / 中国内地 三种写法都表示内地
 * - 香港 / 中国香港、台湾 / 中国台湾 不一致
 * - 多值分隔符有 4 种：` \/ ` 转义斜杠、` / `、` , ` 逗号、纯空格
 *   （如 `美国  英国  马耳他  摩洛哥`）
 * - 还有 `其它` 与一堆小国（马耳他/阿尔巴尼亚/越南…）
 *
 * 只归一成 UI 展示的 9 个地区，其余（其它/小国/空）返回空数组，
 * 不会命中任何地区筛选。标签名与前端 AREA_OPTIONS 严格一致。
 */
function areaTags(raw?: string): string[] {
  if (!raw) return [];
  const s = raw.replace(/\\/g, '').replace(/[\/,]/g, ' ').trim();
  const tokens = s.split(/\s+/).filter(Boolean);
  const tags = new Set<string>();
  for (const tok of tokens) {
    if (/大陆|中国内地|中国$/.test(tok)) tags.add('内地');
    else if (/香港/.test(tok)) tags.add('中国香港');
    else if (/台湾/.test(tok)) tags.add('中国台湾');
    else if (/美国/.test(tok)) tags.add('美国');
    else if (/英国/.test(tok)) tags.add('英国');
    else if (/印度/.test(tok)) tags.add('印度');
    else if (/加拿大/.test(tok)) tags.add('加拿大');
    else if (/韩国/.test(tok)) tags.add('韩国');
    else if (/日本/.test(tok)) tags.add('日本');
  }
  return [...tags];
}

/**
 * 单源分类浏览。
 * - sort=new 且 area=all：直取模式，每次响应 24 条（并发拉 2 个源站页），支持全量分页
 * - 否则进入窗口模式：
 *   - 地区过滤：拉最近 500 部（AREA_WINDOW_PAGES）按真实 vod_area 归一化后筛
 *   - hot/score 排序：拉最近 100 部按真实 vod_hits / vod_score 降序
 *   - 两者可组合（地区筛选后再按热度/评分排）
 * 与 /api/search 同一套上游代理 + SSRF 校验，只是把关键词 wd= 换成分类 t=。
 */
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let body: CategoryBody;
  try {
    body = (await req.json()) as CategoryBody;
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const { source } = body;
  const filterAdult = resolveAdultFilter(body.filterAdult);
  const t = Number(body.t);
  const pg = Math.min(Math.max(parseInt(String(body.pg ?? '1'), 10) || 1, 1), MAX_PG);
  const sort: CategorySort =
    body.sort === 'hot' || body.sort === 'score' ? body.sort : 'new';
  const areaRaw = typeof body.area === 'string' ? body.area.trim() : 'all';
  const areaActive = areaRaw !== 'all' && areaRaw !== '';

  if (!source || typeof source.url !== 'string' || !/^https?:\/\//.test(source.url)) {
    return NextResponse.json({ error: '无效的源' }, { status: 400 });
  }
  if (!Number.isFinite(t) || t <= 0) {
    return NextResponse.json({ error: '无效的分类' }, { status: 400 });
  }

  // 用户可控地址发起服务端请求，必须先过 SSRF 校验
  const verdict = await checkUpstreamOrIngest(source.url);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 400 });
  }

  const base = source.url.replace(/\/+$/, '');

  // ── 全量直取：仅「最新 + 全部地区」走这条路 ──
  if (sort === 'new' && !areaActive) {
    // 每次响应 24 条：源站每页硬 20 条，故并发拉 2 页（2N-1, 2N）合并去重取前 24
    const srcPgA = pg * 2 - 1;
    const srcPgB = pg * 2;
    const pageUrl = (p: number) =>
      `${base}?ac=videolist&t=${encodeURIComponent(String(t))}&pg=${p}`;
    try {
      const [resA, resB] = await Promise.all(
        [srcPgA, srcPgB].map((p) =>
          fetchUpstream(pageUrl(p), { timeoutMs: PAGE_TIMEOUT_MS, headers: cmsRequestHeaders() })
        )
      );
      if (!resA.ok) {
        return NextResponse.json({ error: `源返回 HTTP ${resA.status}` }, { status: 502 });
      }
      const dataA = (await resA.json()) as {
        pagecount?: unknown;
        total?: unknown;
      };
      const rawA = parseSearchList(dataA, source);
      let rawB: SearchResultItem[] = [];
      if (resB.ok) {
        try {
          rawB = parseSearchList((await resB.json()) as unknown, source);
        } catch {
          // 第二页解析失败不阻塞：第一页仍可出 20 条
        }
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
      // 前端每页 24 条 = 2 个源站页
      const pagecount = Math.max(1, Math.ceil(srcPagecount / 2));
      const list = filterAdultResults(merged, filterAdult).slice(0, PER_PAGE);
      return NextResponse.json({ list, page: pg, pagecount, total, sort, area: 'all' });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : '分类请求失败' },
        { status: 502 }
      );
    }
  }

  // ── 窗口模式：地区过滤 或 hot/score 排序 ──
  const windowPages = areaActive ? AREA_WINDOW_PAGES : SORT_WINDOW_PAGES;
  const cacheKey = `${base}|${t}|w${windowPages}|${filterAdult}`;
  let items = windowCacheGet(cacheKey);
  if (!items) {
    items = await buildWindow(base, source, t, windowPages, filterAdult);
    if (!items) {
      return NextResponse.json({ error: '分类请求失败' }, { status: 502 });
    }
    windowCacheSet(cacheKey, items);
  }

  // 地区过滤（源站 area= 参数被忽略，只能本地按归一化标签筛）
  let filtered = items;
  if (areaActive) {
    filtered = items.filter((it) => areaTags(it.area).includes(areaRaw));
  }

  // 排序（new 保持窗口内默认顺序 = 源按更新时间倒序）
  if (sort === 'hot') {
    filtered = filtered.slice().sort((a, b) => (b.hits ?? -1) - (a.hits ?? -1));
  } else if (sort === 'score') {
    filtered = filtered.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }

  const total = filtered.length;
  const pagecount = Math.max(1, Math.ceil(total / PER_PAGE));
  const start = (pg - 1) * PER_PAGE;
  const list = filtered.slice(start, start + PER_PAGE);

  return NextResponse.json({ list, page: pg, pagecount, total, sort, area: areaRaw });
}
