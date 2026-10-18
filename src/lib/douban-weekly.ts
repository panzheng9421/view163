import type { DoubanItem } from './types';
import { fetchUpstream } from './fetch-utils';
import { rankCacheGetOrLoad } from './rank-cache';
import { fetchDoubanRank, fetchDoubanRankPage, isDoubanRankId } from './douban-rank';

/**
 * 影视热榜聚合，两个来源：
 * 1) 60s API（免 key，https://github.com/vikiboss/60s）：豆瓣五个一周口碑榜 +
 *    百度热播剧榜，均由其代为抓取；
 * 2) 豆瓣官方 rexxar 移动端直连（见 douban-rank.ts）：高分经典 Top250 /
 *    热播剧集等完整榜单。
 * 本文件负责统一入口：服务端转发 + 内存缓存 + 字段归一。
 * 60s 默认走社区实例 crystelf.top，失败自动回退官方公共实例（每日额度有限，
 * 数据中心出口 IP 常被限流，Vercel 上不可依赖）；可用 60S_API_BASE 指向自部署实例。
 */

const UA = 'view163';

const FALLBACK_BASE = 'https://60s.viki.moe';

function apiBase(): string {
  return (process.env['60S_API_BASE'] || 'https://60s.crystelf.top').replace(/\/+$/, '');
}

/** 榜单标识：豆瓣五个周榜 + 百度热播剧榜（60s 转发）+ 豆瓣直连榜单（Top250/热播剧集） */
export const HOT_LIST_IDS = [
  'douban_movie_weekly',
  'douban_tv_chinese',
  'douban_tv_global',
  'douban_show_chinese',
  'douban_show_global',
  'baidu_teleplay',
  'douban_top250',
  'douban_tv_hot',
  'douban_movie_score',
] as const;

export type HotListId = (typeof HOT_LIST_IDS)[number];

export function isHotListId(id: string): id is HotListId {
  return (HOT_LIST_IDS as readonly string[]).includes(id);
}

const DOUBAN_WEEKLY_CATEGORY: Partial<Record<HotListId, string>> = {
  douban_movie_weekly: 'movie',
  douban_tv_chinese: 'tv_chinese',
  douban_tv_global: 'tv_global',
  douban_show_chinese: 'show_chinese',
  douban_show_global: 'show_global',
};

// —— 60s API 原始结构（只取用到的字段） ——

interface DoubanWeeklyRaw {
  id?: number | string;
  title?: string;
  rating?: number;
  cover_proxy?: string;
  cover?: string;
}

interface BaiduTeleplayRaw {
  title?: string;
  cover?: string | null;
}

interface SixtyResponse<T> {
  code?: number;
  data?: T;
}

/** 豆瓣周榜条目 → DoubanItem；缺标题或封面的脏数据丢弃 */
export function doubanWeeklyToItem(raw: DoubanWeeklyRaw, isTv: boolean): DoubanItem | undefined {
  // 原生 cover 是 img*.doubanio.com，命中图片代理的豆瓣白名单并带 Referer 伪装，
  // 可稳定加载；cover_proxy（doubanio.viki.moe 公共镜像）限流严重，仅作兜底
  const cover = raw.cover || raw.cover_proxy;
  if (!raw.id || !raw.title || !cover) return undefined;
  return {
    id: String(raw.id),
    title: raw.title,
    cover,
    rating: raw.rating && raw.rating > 0 ? String(raw.rating) : undefined,
    isTv,
  };
}

/** 百度热播剧条目 → DoubanItem；无评分，海报为空的条目丢弃 */
export function baiduTeleplayToItem(raw: BaiduTeleplayRaw, index: number): DoubanItem | undefined {
  if (!raw.title || !raw.cover) return undefined;
  return {
    // 百度榜无稳定 id，用榜单内序号保证 React key 唯一
    id: `baidu_${index}`,
    title: raw.title,
    cover: raw.cover,
    isTv: true,
  };
}

function assertArray<T>(value: unknown, what: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${what}数据异常`);
  return value as T[];
}

async function fetchJson(path: string): Promise<unknown> {
  const primary = apiBase();
  // 主实例失败（限流/宕机/网络不通）时回退官方实例；两者相同则只试一次
  const bases = primary === FALLBACK_BASE ? [primary] : [primary, FALLBACK_BASE];

  let lastError: unknown;
  for (const base of bases) {
    try {
      const res = await fetchUpstream(`${base}${path}`, {
        timeoutMs: 8000,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`60s API 响应异常 (${res.status})`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('60s API 请求失败');
}

export async function fetchHotList(id: HotListId): Promise<DoubanItem[]> {
  // 豆瓣直连榜单（Top250 / 热播剧集）走独立链路，不经过 60s
  if (isDoubanRankId(id)) return fetchDoubanRank(id);
  return rankCacheGetOrLoad(`hot-list:${id}`, () => loadHotList(id));
}

/** 回源拉取（不含缓存逻辑）：冷启动同步调用，软过期后由 rankCacheGetOrLoad 后台调用 */
async function loadHotList(id: HotListId): Promise<DoubanItem[]> {
  let items: DoubanItem[];

  const category = DOUBAN_WEEKLY_CATEGORY[id];
  if (category) {
    const raw = (await fetchJson(`/v2/douban/weekly/${category}`)) as SixtyResponse<DoubanWeeklyRaw[]>;
    const isTv = id !== 'douban_movie_weekly';
    items = assertArray<DoubanWeeklyRaw>(raw.data, '豆瓣周榜')
      .map((entry) => doubanWeeklyToItem(entry, isTv))
      .filter((item): item is DoubanItem => item !== undefined);
  } else {
    const raw = (await fetchJson('/v2/baidu/teleplay')) as SixtyResponse<BaiduTeleplayRaw[]>;
    items = assertArray<BaiduTeleplayRaw>(raw.data, '百度热播剧榜')
      .map((entry, i) => baiduTeleplayToItem(entry, i))
      .filter((item): item is DoubanItem => item !== undefined);
  }

  if (items.length === 0) throw new Error('榜单数据为空');

  return items;
}

/**
 * 分页版（「查看更多」全部页使用）：直连榜单从全量切片；
 * 60s 周榜单本身只有 10 条且无翻页能力，start/count 忽略、一次性返回全量。
 */
export async function fetchHotListPage(
  id: HotListId,
  start: number,
  count: number
): Promise<{ items: DoubanItem[]; total: number }> {
  if (isDoubanRankId(id)) return fetchDoubanRankPage(id, start, count);
  const items = await fetchHotList(id);
  return { items: items.slice(start, start + count), total: items.length };
}
