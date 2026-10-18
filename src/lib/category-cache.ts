/**
 * 分类窗口缓存：Redis 优先，Redis 不可用时自动降级到「小容量进程内 LRU」。
 *
 * 为什么不放进程内存：
 * - 窗口结果单条 60~500 部片，key 空间约 8 源 × 30 分类 × 多种窗口 ≈ 500 个，
 *   全放进程内存是百 MB 级，最坏情况会把 Next 主进程一起拖到 OOM（整站挂掉）。
 * - Redis 是独立进程，maxmemory + allkeys-lru 硬封顶，撑死只是缓存淘汰，
 *   主进程毫发无损；容器重启缓存丢了自动重拉（启动即有预热一轮）。
 *
 * 降级策略：
 * - 未配置 CATEGORY_REDIS_URL（本地开发）：纯内存 LRU，上限很小（默认 50 条）。
 * - Redis 连续失败：熔断 60 秒走内存，之后自动重试，不会每个请求都卡连接超时。
 */
import { Redis } from 'ioredis';
import type { SearchResultItem } from './types';

/** Redis 连接串；留空则完全不碰 Redis（本地开发默认行为） */
const REDIS_URL = (process.env.CATEGORY_REDIS_URL || '').trim();

/**
 * 缓存 TTL，默认 30 天。分类榜单（评分 / 热度 / 地区筛选）源站数据变化极慢，
 * 不需要分钟级新鲜度；首页实时榜单（豆瓣 / 60s）不走这里。
 */
const TTL_MS = (() => {
  const n = parseInt(process.env.CATEGORY_WINDOW_TTL_MS || '', 10);
  if (Number.isFinite(n) && n >= 1000) return n;
  return 30 * 24 * 60 * 60 * 1000;
})();
const TTL_SEC = Math.max(60, Math.floor(TTL_MS / 1000));

/** 降级内存缓存上限：只在 Redis 不可用时兜底，必须小，避免回到 OOM 老路 */
const FALLBACK_MAX = (() => {
  const n = parseInt(process.env.CATEGORY_WINDOW_CACHE_MAX || '50', 10);
  return Number.isFinite(n) && n >= 10 ? n : 50;
})();

const KEY_PREFIX = 'v163:catwin:';

/** 进程内兜底缓存（LRU，靠 Map 插入顺序：命中先删再插 = 移到末尾） */
const fallback = new Map<string, { ts: number; items: SearchResultItem[] }>();

let client: Redis | null = null;
let disabledUntil = 0;
let failStreak = 0;

function fallbackGet(key: string): SearchResultItem[] | null {
  const hit = fallback.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts >= TTL_MS) {
    fallback.delete(key);
    return null;
  }
  fallback.delete(key);
  fallback.set(key, hit);
  return hit.items;
}

function fallbackSet(key: string, items: SearchResultItem[]): void {
  fallback.delete(key);
  fallback.set(key, { ts: Date.now(), items });
  while (fallback.size > FALLBACK_MAX) {
    const oldest = fallback.keys().next();
    if (oldest.done) break;
    fallback.delete(oldest.value);
  }
}

/** 断开当前连接并丢弃引用，下次 getClient() 自动重建（retryStrategy 负责重连） */
function reconnect(c: Redis): void {
  if (client === c) client = null;
  try {
    c.disconnect();
  } catch {
    /* 断开失败无所谓 */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 熔断：断开连接并在一段时间内不再尝试 Redis */
function trip(ms: number): void {
  disabledUntil = Date.now() + ms;
  if (client) {
    try {
      client.disconnect();
    } catch {
      /* 断开失败无所谓，直接丢弃引用 */
    }
    client = null;
  }
}

function getClient(): Redis | null {
  if (!REDIS_URL || Date.now() < disabledUntil) return null;
  if (client) return client;
  try {
    const c = new Redis(REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 2000,
      commandTimeout: 3000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      // 持续重试、永不放弃：缓存连接抖动应该自愈，而不是永久失效
      // （曾用「重试 2 次后返回 null」，结果启动竞态失败一次就永久走内存兜底）
      retryStrategy: (times: number) => Math.min(times * 500, 5000),
    });
    c.on('error', (err: Error) => {
      // 连接抖动不熔断（retryStrategy 会自愈），只在连续多次异常时提示一次
      failStreak += 1;
      if (failStreak === 5 || failStreak % 50 === 0) {
        console.warn(`[category-cache] redis 连接异常（第 ${failStreak} 次）：`, err.message);
      }
    });
    c.on('ready', () => {
      failStreak = 0;
    });
    client = c;
    return c;
  } catch (err) {
    console.warn('[category-cache] redis 初始化失败，走内存兜底：', (err as Error).message);
    trip(60_000);
    return null;
  }
}

/** 读缓存；未命中 / Redis 不可用 / 已过期都返回 null（调用方负责回源） */
export async function cacheGet(key: string): Promise<SearchResultItem[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = getClient();
    if (!c) return fallbackGet(key);
    try {
      const raw = await c.get(KEY_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SearchResultItem[];
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      failStreak = 0;
      return parsed;
    } catch (err) {
      // 第一次失败多为「连接还没 ready」的启动竞态：断开重连、稍等再试一次
      if (attempt === 0 && (err as Error).message.includes('writeable')) {
        reconnect(c);
        await sleep(200);
        continue;
      }
      console.warn('[category-cache] redis get 失败：', (err as Error).message);
      return fallbackGet(key);
    }
  }
  return null;
}

/** 写缓存；TTL 由 SET EX 原生维护，Redis 不可用时写内存兜底 */
export async function cacheSet(key: string, items: SearchResultItem[]): Promise<void> {
  const raw = JSON.stringify(items);
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = getClient();
    if (!c) {
      fallbackSet(key, items);
      return;
    }
    try {
      await c.set(KEY_PREFIX + key, raw, 'EX', TTL_SEC);
      failStreak = 0;
      return;
    } catch (err) {
      if (attempt === 0 && (err as Error).message.includes('writeable')) {
        reconnect(c);
        await sleep(200);
        continue;
      }
      console.warn('[category-cache] redis set 失败：', (err as Error).message);
      fallbackSet(key, items);
      return;
    }
  }
}

/** 供健康检查 / 排障：当前缓存后端 */
export function cacheBackend(): 'redis' | 'memory' {
  return REDIS_URL && Date.now() >= disabledUntil ? 'redis' : 'memory';
}
