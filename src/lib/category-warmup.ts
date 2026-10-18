/**
 * 分类缓存后台预热：把「所有有分类映射的源 × 全部分类标签 × 两种窗口」全部刷进缓存，
 * 让用户无论点哪个分类、哪个地区、哪种排序，都命中缓存（20ms 级），而不是 2~9 秒冷启动。
 *
 * 设计要点：
 * - **目标自动枚举**：源取 DEFAULT_SOURCES，分类取 categories.ts 的 CATEGORY_MAP 映射。
 *   只有映射过的源才支持分类浏览（前端 getSubCategories 同理），未映射的源自动跳过。
 *   以后给某个源补了分类映射，预热自动覆盖，不用改这里。
 * - **两种窗口都预热**：排序窗口（3 页）覆盖 score/hot；地区窗口（25 页）覆盖全部地区筛选
 *   （地区是在同一批数据上本地筛的，与具体地区无关，一个分类刷一次即可）。
 * - **严格限速**：窗口串行 + 少量并发，避免几十个并发请求把源站 / 代理打爆或被限流。
 * - **失败无害**：单个窗口失败只记日志，不影响线上请求，下个周期自动重试。
 * - **构建期不跑**：next build 也会 import 路由模块，用 NEXT_PHASE 守卫掉。
 */
import { CATEGORY_ORDER, getSubCategories } from './categories';
import { cacheSetSwr } from './category-cache';
import {
  AREA_WINDOW_PAGES,
  DIRECT_TTL_SEC,
  SORT_WINDOW_PAGES,
  WINDOW_SOFT_TTL_SEC,
  buildWindow,
  directCacheKey,
  fetchDirectPage,
  hitRateLimit,
  recentPageFailures,
  windowCacheKey,
} from './category-window';
import type { SourceConfig } from './types';

/** 预热周期，默认 6 小时（远小于 30 天 TTL，只做日级保鲜） */
const WARM_INTERVAL_MS = (() => {
  const n = parseInt(process.env.CATEGORY_WARM_INTERVAL_MS || '', 10);
  return Number.isFinite(n) && n >= 60_000 ? n : 6 * 60 * 60 * 1000;
})();

/** 每个窗口之间的间隔（默认 1.2s）：温和刷新，别把源站打到 429 */
const WARM_GAP_MS = (() => {
  const n = parseInt(process.env.CATEGORY_WARM_GAP_MS || '1200', 10);
  return Number.isFinite(n) && n >= 0 && n <= 60_000 ? n : 1200;
})();

/** 命中 429 后的退避时长（默认 90s）：等源站限流窗口过去 */
const WARM_BACKOFF_MS = (() => {
  const n = parseInt(process.env.CATEGORY_WARM_BACKOFF_MS || '90000', 10);
  return Number.isFinite(n) && n >= 1000 && n <= 600_000 ? n : 90_000;
})();

/** 同时预热的窗口数（每个窗口内部还会分批并发拉页，故这里刻意保守，默认串行） */
const WARM_CONCURRENCY = (() => {
  const n = parseInt(process.env.CATEGORY_WARM_CONCURRENCY || '1', 10);
  return Number.isFinite(n) && n >= 1 && n <= 8 ? n : 1;
})();

/** 容器起来后延迟多久开始预热（默认 5s）：等 Next 就绪、Redis 连接建立，避开启动竞态 */
const WARM_START_DELAY_MS = (() => {
  const n = parseInt(process.env.CATEGORY_WARM_START_DELAY_MS || '5000', 10);
  return Number.isFinite(n) && n >= 0 && n <= 120_000 ? n : 5000;
})();

interface WarmTarget {
  source: SourceConfig;
  /** 源站 base（去掉尾斜杠的 api 地址） */
  base: string;
  t: number;
  windowPages: number;
  label: string;
  /** sort=「最新」直取页（分类页默认排序，必须预热，否则默认路径永远冷启动） */
  directPg?: number;
}

/** 从 DEFAULT_SOURCES 解析预置源（与前端 /api/status 下发的是同一份配置） */
function presetSources(): SourceConfig[] {
  const raw = process.env.DEFAULT_SOURCES || '';
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is SourceConfig => !!x && typeof x.url === 'string');
  } catch {
    return [];
  }
}

/**
 * 枚举全部预热目标：源 × 该源全部分类标签 × 窗口。
 *
 * 默认只预热「排序窗口」（3 页/分类，26 个分类共 78 个页请求）——覆盖所有分类 tab 的
 * score/hot/new 三种排序，一两分钟跑完，不会把源站打到限流。
 *
 * 地区窗口（25 页/分类，26 个分类 = 650+ 页请求）默认**不预热**：实测全量预热带 429 限流，
 * 把用户请求一起害死（用户看到的就是 5 秒+失败）。地区筛选是低频操作，用户首次选中
 * 冷启动一次（3~9s）后进缓存 30 天，比「预热把源站打到限流、大家一起失败」划算。
 * 确实要全预热可设 CATEGORY_WARM_AREA=1（配合下面的 gap/退避使用）。
 */
function warmTargets(): WarmTarget[] {
  const wantArea = process.env.CATEGORY_WARM_AREA === '1';
  const out: WarmTarget[] = [];
  for (const source of presetSources()) {
    const base = source.url.replace(/\/+$/, '');
    for (const cat of CATEGORY_ORDER) {
      const subs = getSubCategories(source.url, cat);
      if (!subs) continue;
      for (const sub of subs) {
        out.push({ source, base, t: sub.t, windowPages: SORT_WINDOW_PAGES, label: `${cat}/${sub.name}(排序)` });
        // 「最新」直取第一页：分类页默认排序，历史上完全没缓存（用户默认路径 2.5s+ 的根源）
        out.push({ source, base, t: sub.t, windowPages: 0, directPg: 1, label: `${cat}/${sub.name}(最新)` });
        if (wantArea) {
          out.push({ source, base, t: sub.t, windowPages: AREA_WINDOW_PAGES, label: `${cat}/${sub.name}(地区)` });
        }
      }
    }
  }
  return out;
}

async function refreshOne(target: WarmTarget, filterAdult: boolean): Promise<void> {
  try {
    if (target.directPg) {
      // 「最新」直取页：短 TTL 缓存（默认 10 分钟），保新鲜度
      const key = directCacheKey(target.base, target.t, target.directPg, filterAdult);
      const page = await fetchDirectPage(target.base, target.source, target.t, target.directPg, filterAdult);
      if (page && page.list.length > 0) {
        await cacheSetSwr(key, page, DIRECT_TTL_SEC, 24 * 60 * 60);
      } else {
        const why = recentPageFailures().slice(-3).join(' | ') || '无失败记录';
        console.warn(`[category-warmup] ${target.label} 失败（${why}）`);
      }
      return;
    }
    const key = windowCacheKey(target.base, target.t, target.windowPages, filterAdult);
    const items = await buildWindow(target.base, target.source, target.t, target.windowPages, filterAdult);
    if (items) {
      await cacheSetSwr(key, items, WINDOW_SOFT_TTL_SEC);
    } else {
      // 全部页失败：打日志便于诊断（源站限流 / 页超时都会走到这里）
      const why = recentPageFailures().slice(-3).join(' | ') || '无失败记录';
      console.warn(`[category-warmup] ${target.label} 全部页失败（${why}）`);
    }
  } catch (err) {
    // 预热失败不影响线上请求，下个周期再试
    console.warn(`[category-warmup] ${target.label} 预热异常：`, (err as Error).message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 限量并发跑任务队列：
 * - 窗口之间留间隔（WARM_GAP_MS）：别把源站按着打，密集请求实测触发 429 限流
 * - 命中 429（hitRateLimit）主动退避（WARM_BACKOFF_MS）：限流期间用户请求也会失败，预热必须让路
 */
async function runLimited(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= tasks.length) return;
      if (hitRateLimit()) {
        console.warn(`[category-warmup] 源站限流中，退避 ${(WARM_BACKOFF_MS / 1000).toFixed(0)}s 再继续`);
        await sleep(WARM_BACKOFF_MS);
      }
      await tasks[idx]();
      await sleep(WARM_GAP_MS);
    }
  });
  await Promise.all(workers);
}

/** 跑一轮完整预热；filterAdult 恒为 true（成人过滤已强制开启，见 cms-parser） */
export async function warmOnce(): Promise<{ total: number; ms: number }> {
  const targets = warmTargets();
  const start = Date.now();
  await runLimited(targets.map((t) => () => refreshOne(t, true)), WARM_CONCURRENCY);
  return { total: targets.length, ms: Date.now() - start };
}

/**
 * 调度：进程起来后立刻跑一轮（用户问过「多久能热」，实测电影分类约 6~7 秒；
 * 全量分类因窗口更多需要几分钟，故启动预热放在后台异步，不阻塞首访），
 * 之后按 WARM_INTERVAL_MS 周期刷新。用 globalThis 保证同一进程内只调度一次。
 */
export function startWarmupScheduler(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const g = globalThis as { __catWarmupStarted?: boolean };
  if (g.__catWarmupStarted) return;
  g.__catWarmupStarted = true;

  const tick = () => {
    void warmOnce()
      .then(({ total, ms }) => {
        console.log(`[category-warmup] 完成一轮：${total} 个窗口，耗时 ${(ms / 1000).toFixed(1)}s`);
      })
      .catch((err: Error) => {
        console.warn('[category-warmup] 一轮预热异常：', err.message);
      });
  };

  // 首轮延迟启动：等 Next 就绪 + Redis 连接建立，避开「容器起来就写 Redis」的启动竞态
  if (WARM_START_DELAY_MS > 0) {
    setTimeout(tick, WARM_START_DELAY_MS);
  } else {
    tick();
  }
  setInterval(tick, WARM_INTERVAL_MS);
}
