import type { DoubanItem } from './types';
import { fetchUpstreamJson, getCache, setCache } from './fetch-utils';
import { DOUBAN_RANKS, type DoubanRankId } from './douban-rank-shared';

export { DOUBAN_RANKS, isDoubanRankId } from './douban-rank-shared';
export type { DoubanRankId } from './douban-rank-shared';

/**
 * 豆瓣榜单直连（rexxar 移动端 subject_collection 接口，UA + Referer 伪装免 key）。
 * 与 douban-weekly.ts 的分工：那个经 60s API 只转发 5 个「一周口碑榜」；
 * 本文件服务端直连豆瓣官方，取高分经典 Top250 / 热播剧集等完整榜单，
 * 评分/封面均为豆瓣原生数据（非哈希美化值）。
 *
 * 分页行为实测（2026-10-17）：豆瓣对 tv_hot 有单页 50 条硬上限（count=300 也只回 50），
 * top250 则可一次返回全部 250 条。因此全量按 50/页翻页拉取，翻到不足一页即停；
 * 首页横滑只需前 20 条，单独走第一页（50 条）切片，不拖慢首屏。
 */

const CACHE_TTL = 60 * 60 * 1000;
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** 单页大小：豆瓣 rexxar 单页硬上限 50 */
const PAGE_SIZE = 50;
/** 翻页安全阀：最多 20 页（1000 条），防豆瓣接口异常导致死循环 */
const MAX_PAGES = 20;

// —— 豆瓣 rexxar 原始结构（只取用到的字段） ——

interface RankRawSubject {
  id?: string | number;
  title?: string;
  year?: string;
  pic?: { normal?: string; large?: string };
  // movie_score（高分电影）等榜用 cover.url 而非 pic
  cover?: { url?: string };
  rating?: { value?: number };
}

interface RankResponse {
  subject_collection_items?: RankRawSubject[];
  total?: number;
}

function itemsUrl(slug: string, start: number, count: number): string {
  return (
    `https://m.douban.com/rexxar/api/v2/subject_collection/${slug}/items` +
    `?start=${start}&count=${count}&items_only=1&for_mobile=1`
  );
}

/** 归一一页原始数据：缺标题/封面的脏数据丢弃；seen 去重防翻页边界重复 */
function normalizePage(
  raws: RankRawSubject[],
  isTv: boolean,
  seen: Set<string>
): DoubanItem[] {
  const items: DoubanItem[] = [];
  for (const s of raws) {
    // 原生 cover 为 img*.doubanio.com，与周榜同链路：命中图片代理豆瓣白名单，
    // 带 Referer 伪装可稳定加载；s_ratio_poster（normal）尺寸已够卡片使用。
    // 注意：不同榜单封面字段不一致——top250/tv_hot 用 pic，movie_score 用 cover.url
    const cover = s.pic?.normal || s.pic?.large || s.cover?.url;
    if (!s.id || !s.title || !cover) continue;
    const id = String(s.id);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      title: s.title,
      cover,
      // rating.value 为 0 即未开分（新开播剧集常见），与周榜规则一致不上屏
      rating: s.rating?.value && s.rating.value > 0 ? String(s.rating.value) : undefined,
      isTv,
    });
  }
  return items;
}

/** 首页横滑：只拉第一页（50 条）切前 railCount（24），保证首屏速度 */
export async function fetchDoubanRank(id: DoubanRankId): Promise<DoubanItem[]> {
  const conf = DOUBAN_RANKS[id];
  const cacheKey = `douban-rank-rail:${id}`;
  const cached = getCache<DoubanItem[]>(cacheKey);
  if (cached) return cached;

  const raw = await fetchUpstreamJson<RankResponse>(itemsUrl(conf.slug, 0, PAGE_SIZE), {
    timeoutMs: 8000,
    headers: {
      'User-Agent': UA,
      Referer: 'https://m.douban.com/subject_collection',
      Accept: 'application/json',
    },
  });

  const items = normalizePage(raw.subject_collection_items ?? [], conf.isTv, new Set()).slice(
    0,
    conf.railCount
  );
  if (items.length === 0) throw new Error('榜单数据为空');

  setCache(cacheKey, items, CACHE_TTL);
  return items;
}

/** 拉取单个榜单全量（翻页循环），供「查看更多」全部页切片使用 */
async function fetchRankFull(id: DoubanRankId): Promise<DoubanItem[]> {
  const conf = DOUBAN_RANKS[id];
  const cacheKey = `douban-rank:${id}`;
  const cached = getCache<DoubanItem[]>(cacheKey);
  if (cached) return cached;

  const all: DoubanItem[] = [];
  const seen = new Set<string>();
  let total: number | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const raw = await fetchUpstreamJson<RankResponse>(
      itemsUrl(conf.slug, page * PAGE_SIZE, PAGE_SIZE),
      {
        timeoutMs: 10000,
        headers: {
          'User-Agent': UA,
          Referer: 'https://m.douban.com/subject_collection',
          Accept: 'application/json',
        },
      }
    );
    total = raw.total ?? total;
    const pageItems = normalizePage(raw.subject_collection_items ?? [], conf.isTv, seen);
    if (pageItems.length === 0) break; // 没有更多了
    all.push(...pageItems);
    // 不足一页 = 已到榜尾；或已达豆瓣声明的 total
    if (pageItems.length < PAGE_SIZE) break;
    if (total !== undefined && all.length >= total) break;
  }

  if (all.length === 0) throw new Error('榜单数据为空');

  setCache(cacheKey, all, CACHE_TTL);
  return all;
}

/** 全部页分页：从全量切片，返回条数与总量 */
export async function fetchDoubanRankPage(
  id: DoubanRankId,
  start: number,
  count: number
): Promise<{ items: DoubanItem[]; total: number }> {
  const all = await fetchRankFull(id);
  return { items: all.slice(start, start + count), total: all.length };
}
