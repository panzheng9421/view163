import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { cmsRequestHeaders, filterAdultResults, parseSearchList, resolveAdultFilter } from '@/lib/cms-parser';
import { checkUpstreamOrIngest, fetchUpstream } from '@/lib/fetch-utils';
import type { CategorySort, SearchResultItem, SourceConfig } from '@/lib/types';
import { cacheGet, cacheSet } from '@/lib/category-cache';
import { startWarmupScheduler } from '@/lib/category-warmup';
import {
  AREA_WINDOW_PAGES,
  PAGE_TIMEOUT_MS,
  SORT_WINDOW_PAGES,
  buildWindow,
  windowCacheKey,
} from '@/lib/category-window';

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
 * 取样窗口页数 / 单页超时 / 缓存 key：lib/category-window.ts（请求与预热共用同一套）
 * 缓存存储与 TTL：lib/category-cache.ts（Redis 优先，降级小容量内存 LRU）
 * 后台预热调度：lib/category-warmup.ts（全部源 × 全部分类标签 × 两种窗口）
 *
 * 这里在路由模块加载时启动调度器：实测服务启动后几秒内预热即开始跑，
 * 用户首访基本都是命中缓存。
 */
startWarmupScheduler();

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
  const cacheKey = windowCacheKey(base, t, windowPages, filterAdult);
  let items = await cacheGet(cacheKey);
  if (!items) {
    items = await buildWindow(base, source, t, windowPages, filterAdult);
    if (!items) {
      return NextResponse.json({ error: '分类请求失败' }, { status: 502 });
    }
    await cacheSet(cacheKey, items);
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
