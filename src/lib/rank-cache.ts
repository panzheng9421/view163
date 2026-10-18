import { cacheGetJson, cacheSetJson } from './category-cache';

/**
 * 榜单/推荐数据的常驻缓存：只走 Redis，不设进程内存层。
 *
 * 采用 stale-while-revalidate：Redis 里存「数据 + 软过期时间」。
 * - 未到软过期：直接返回（一次 GET，不到 1ms）
 * - 已过软过期：**先返回旧数据**，同时后台异步拉新写回，用户不等待
 * - 硬过期（7 天）：彻底失效，同步回源
 *
 * 并发保护：同一 key 同一时刻只有一个回源请求（single-flight），
 * 避免「缓存刚过期 + 多个访客同时进来」打多次上游。
 */

/** 榜单默认软过期：24 小时（豆瓣周榜一天一更，实测数天不变） */
export const RANK_TTL_MS = 24 * 60 * 60 * 1000;
/** 硬过期：7 天。过了软过期仍可继续兜底返回旧数据，超过 7 天视为不可用 */
const HARD_TTL_SEC = 7 * 24 * 60 * 60;

const KEY_PREFIX = 'rank:';

/** 缓存信封：v = 数据，e = 软过期时间戳（epoch ms） */
interface Envelope<T> {
  v: T;
  e: number;
}

/** 正在进行中的回源请求（key -> Promise），用于请求合并 */
const inflight = new Map<string, Promise<unknown>>();

export async function rankCacheGet<T>(key: string): Promise<T | null> {
  const env = await cacheGetJson<Envelope<T>>(KEY_PREFIX + key);
  return env && typeof env.e === 'number' ? env.v : null;
}

export async function rankCacheSet<T>(key: string, value: T, ttlMs: number = RANK_TTL_MS): Promise<void> {
  await cacheSetJson(KEY_PREFIX + key, { v: value, e: Date.now() + ttlMs }, HARD_TTL_SEC);
}

/** 同一 key 的回源去重：已有请求在跑就复用同一个 Promise */
function refreshOnce<T>(key: string, load: () => Promise<T>, ttlMs: number): Promise<T> {
  const k = KEY_PREFIX + key;
  const running = inflight.get(k);
  if (running) return running as Promise<T>;

  const task = (async () => {
    try {
      const value = await load();
      await cacheSetJson(k, { v: value, e: Date.now() + ttlMs }, HARD_TTL_SEC);
      return value;
    } finally {
      inflight.delete(k);
    }
  })();

  inflight.set(k, task);
  return task;
}

/**
 * 读取并在需要时刷新：
 * - 新鲜 → 直接返回
 * - 已过软过期但仍可用 → 返回旧值 + 后台刷新（用户不等待）
 * - 无缓存 → 同步回源（仅冷启动那一次）
 */
export async function rankCacheGetOrLoad<T>(
  key: string,
  load: () => Promise<T>,
  ttlMs: number = RANK_TTL_MS
): Promise<T> {
  const env = await cacheGetJson<Envelope<T>>(KEY_PREFIX + key);

  if (env && typeof env.e === 'number') {
    if (Date.now() < env.e) return env.v;
    // 软过期：后台刷新，本次仍返回旧数据（刷新失败也不影响用户）
    void refreshOnce(key, load, ttlMs).catch((err) => {
      console.warn('[rank-cache] 后台刷新失败：', (err as Error).message);
    });
    return env.v;
  }

  return refreshOnce(key, load, ttlMs);
}
