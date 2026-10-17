'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Header } from '@/components/header';
import { BackToTop } from '@/components/back-to-top';
import { AggregatedCard, aggregateResults } from '@/components/video-card';
import { DetailModal } from '@/components/detail-modal';
import { SiteFooter } from '@/components/site-footer';
import { EmptyState, LoadingState, ErrorState, Spinner } from '@/components/states';
import { Reveal } from '@/components/reveal';
import { useAppStore, resolveSource, isInDisabledSubscription, rankSourcesByHealth } from '@/lib/store';
import { api, fetchStatusWithRetry, STATUS_QUERY_KEY } from '@/lib/client-api';
import type { SearchResultItem, CategoryKey, CategorySort, CategoryResponse, SourceConfig } from '@/lib/types';
import { SLUG_TO_CATEGORY, getSubCategories, AREA_OPTIONS } from '@/lib/categories';
import { cn, validateSourceUrl } from '@/lib/utils';

export default function CategoryPage() {
  return (
    <Suspense>
      <CategoryContent />
    </Suspense>
  );
}

/**
 * 排序行。
 * - 最新：源站默认顺序（bfzy 实测即按更新时间倒序），全量分页
 * - 最热 / 高分好评：源站不支持服务端排序，由后端取最近更新的 100 部按真实
 *   vod_hits / vod_score 降序（属「近期热门 / 近期高分」）
 */
const SORT_OPTIONS: { key: CategorySort; label: string }[] = [
  { key: 'new', label: '最新' },
  { key: 'hot', label: '最热' },
  { key: 'score', label: '高分好评' },
];

function CategoryContent() {
  const params = useParams<{ cat: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const slug = params.cat;
  const cat = SLUG_TO_CATEGORY[slug] as CategoryKey | undefined;

  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const sourceHealth = useAppStore((s) => s.sourceHealth);
  const subscriptions = useAppStore((s) => s.subscriptions);
  const yellowFilter = useAppStore((s) => s.yellowFilter);

  const [detailItem, setDetailItem] = useState<SearchResultItem | null>(null);

  // 与首页一致的选中源解析（去重 + 过滤订阅停用 + 按健康度排序）
  const selectedSources = useMemo(() => {
    const seen = new Set<string>();
    const resolved = selectedKeys
      .map((key) => resolveSource({ customAPIs, envSources }, key))
      .filter((s): s is NonNullable<typeof s> => {
        if (!s || !validateSourceUrl(s.url) || seen.has(s.key)) return false;
        seen.add(s.key);
        return true;
      })
      .filter((s) => !isInDisabledSubscription({ subscriptions }, s.key));
    return rankSourcesByHealth(resolved, sourceHealth);
  }, [customAPIs, envSources, selectedKeys, sourceHealth, subscriptions]);

  // /api/status 预置源：Providers 首屏已用同一 query key 拉过，这里只是复用缓存兜底。
  // 覆盖两种「store 里没有源」的情况：持久化状态尚未 hydrate、首屏那次 /api/status 瞬时失败
  // （envSources 不落 localStorage，首屏拉失败就会整场会话无源可用 → 分类入口变死链）。
  const statusQuery = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: () => fetchStatusWithRetry(4),
    staleTime: 5 * 60_000,
  });
  const presetSources = useMemo(
    () => statusQuery.data?.defaultSources ?? [],
    [statusQuery.data]
  );

  // 分类浏览用哪个源：t= 是源特定的（不同源 type_id 不同），所以必须选定一个源。
  // 三级兜底，保证顶栏分类入口点进来一定有片可看：
  // 1) 用户已勾选的源（已按健康度排序：成功源优先，失败源即便只有一个也不会被丢）
  // 2) store 内其它源（覆盖未勾选情况）
  // 3) /api/status 下发的预置源——覆盖持久化未就绪、首屏拉取失败
  const source = useMemo(() => {
    if (!cat) return null;
    const supports = (s: { url: string }) => Boolean(getSubCategories(s.url, cat));
    const pick = (list: SourceConfig[]) => {
      const seen = new Set<string>();
      return list.find((s) => {
        if (!s || !validateSourceUrl(s.url) || seen.has(s.key)) return false;
        seen.add(s.key);
        return supports(s);
      });
    };
    return (
      pick(selectedSources) ??
      pick([...customAPIs, ...envSources]) ??
      pick(presetSources) ??
      null
    );
  }, [selectedSources, cat, customAPIs, envSources, presetSources]);

  const subs = source && cat ? getSubCategories(source.url, cat) : null;

  // 当前二级子类：query 显式指定则按 name 匹配，否则默认第一个
  const subName = searchParams.get('sub');
  const currentSub = useMemo(() => {
    if (!subs) return null;
    return subs.find((s) => s.name === subName) ?? subs[0];
  }, [subs, subName]);

  // 地区：任意类目都能按地区筛，但「电影」类目才在 UI 展示地区行（其余类目已有地区维度，
  // 如电视剧的二级子类就是按地区分的；综艺/动漫用户未要求）。'全部'/'all'/'空' = 不过滤。
  const areaParam = searchParams.get('area');
  const area = areaParam && areaParam !== '全部' && areaParam !== 'all' ? areaParam : 'all';
  const areaActive = area !== 'all';

  // 排序：new=源默认（时间倒序，全量分页）；hot/score=窗口取样后按真实字段排
  const sortParam = searchParams.get('sort');
  const sort: CategorySort =
    sortParam === 'hot' || sortParam === 'score' ? sortParam : 'new';

  // 上拉加载：翻页状态由 React Query 管理、不写 URL（切筛选条件自动回到第一页）
  const query = useInfiniteQuery({
    queryKey: ['category', source?.key, cat, currentSub?.t, sort, area, yellowFilter],
    queryFn: ({ signal, pageParam }): Promise<CategoryResponse> => {
      if (!source || !currentSub) {
        return Promise.resolve({ list: [], page: pageParam, pagecount: 1, total: 0 });
      }
      return api.category(source, currentSub.t, pageParam, sort, area, yellowFilter, signal);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.pagecount ? lastPage.page + 1 : undefined,
    enabled: Boolean(source && currentSub && cat),
    staleTime: 60_000,
  });

  // 多页合并 + 去重（同一源同一 vodId 只保留首次出现）
  const list = useMemo(() => {
    const seen = new Set<string>();
    const out: SearchResultItem[] = [];
    for (const p of query.data?.pages ?? []) {
      for (const it of p.list) {
        const k = `${it.sourceKey}:${it.vodId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(it);
      }
    }
    return out;
  }, [query.data]);
  const groups = useMemo(() => aggregateResults(list), [list]);
  const total = query.data?.pages[0]?.total ?? 0;

  // 切筛选条件回到顶部（首次进入不滚）
  const filterSig = `${cat}|${currentSub?.t ?? ''}|${sort}|${area}`;
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
  }, [filterSig]);

  // 兼容旧链接：URL 里的 pg 参数已废弃（翻页改上拉加载），进页面时静默清掉
  const stripPg = () => {
    if (!searchParams.has('pg')) return;
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete('pg');
    const qs = sp.toString();
    router.replace(qs ? `/category/${slug}?${qs}` : `/category/${slug}`, { scroll: false });
  };
  useEffect(stripPg, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 哨兵进入视口则自动加载下一页（按钮兜底，双保险）
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !query.hasNextPage || query.isFetchingNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void query.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage, list.length]);

  // 统一拼查询串：sub / sort / area（sort=new、area=all 是默认值，不写进 URL）
  const pushQuery = (next: {
    sub?: string | null;
    sort?: CategorySort;
    area?: string;
  }) => {
    const sp = new URLSearchParams();
    const sub = next.sub !== undefined ? next.sub : currentSub?.name;
    if (sub) sp.set('sub', sub);
    const s = next.sort ?? sort;
    if (s !== 'new') sp.set('sort', s);
    const a = next.area ?? area;
    if (a !== 'all') sp.set('area', a);
    const qs = sp.toString();
    router.push(qs ? `/category/${slug}?${qs}` : `/category/${slug}`, { scroll: false });
  };

  const switchSub = (name: string) => pushQuery({ sub: name });
  const switchSort = (s: CategorySort) => pushQuery({ sort: s });
  const switchArea = (label: string) =>
    pushQuery({ area: label === '全部' ? 'all' : label });

  if (!cat) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 max-w-shell mx-auto px-5 md:px-8 py-10">
          <EmptyState title="找不到该分类" description="请从顶部分类导航进入" />
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 max-w-shell w-full mx-auto px-5 md:px-8 py-6">
        {/* 分类页标题区：此前直接进筛选条，用户看不到「当前在哪个分类」 */}
        <header className="pt-6 pb-4">
          <p className="eyebrow w-fit mb-3">分类浏览</p>
          <h1 className="font-display text-display-md font-semibold text-content leading-none tracking-[-0.02em]">
            {cat}
          </h1>
          <p className="mt-3 text-sm text-muted">按类型浏览全部{cat}，可按地区、更新时间与评分筛选</p>
        </header>

        {!source && (
          <div className="my-4 rounded-tile ring-1 ring-black/[0.08] dark:ring-white/10 bg-chip px-4 py-3 text-sm text-muted">
            {statusQuery.isLoading
              ? '正在准备片源…'
              : '暂时没有可用的片源，请到「设置」里添加或勾选一个源。'}
          </div>
        )}

        {/* 二级子类标签：点击切换 type_id，默认选中第一个 */}
        {subs && subs.length > 1 && (
          <div className="flex flex-wrap gap-2 my-4">
            {subs.map((s) => (
              <button
                key={s.name}
                onClick={() => switchSub(s.name)}
                className={cn(
                  'px-3 py-1.5 rounded-pill text-sm ring-1 ring-black/[0.08] dark:ring-white/10 transition-[background-color,box-shadow,color] duration-700 ease-swift',
                  currentSub?.name === s.name
                    ? 'ring-accent/50 bg-accent/15 text-accent'
                    : 'bg-black/[0.02] dark:bg-white/5 text-muted hover:text-content hover:ring-accent/40'
                )}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {/* 地区行：仅电影类目展示（电影按类型分，无地区维度；电视剧的二级子类本就是地区） */}
        {cat === '电影' && subs && (
          <div className="flex flex-wrap items-center gap-5 my-3 text-sm">
            {AREA_OPTIONS.map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => switchArea(o.label)}
                className={cn(
                  'transition-colors',
                  area === (o.label === '全部' ? 'all' : o.label)
                    ? 'text-accent font-semibold'
                    : 'text-muted hover:text-content'
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}

        {/* 排序行：文字式标签，当前项高亮（对齐主流影视站） */}
        {subs && (
          <div className="flex flex-wrap items-center gap-5 my-3 text-sm">
            {SORT_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => switchSort(o.key)}
                className={cn(
                  'transition-colors',
                  sort === o.key
                    ? 'text-accent font-semibold'
                    : 'text-muted hover:text-content'
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}

        {/* 结果区 */}
        {query.isLoading ? (
          <LoadingState label="加载中…" className="py-20" />
        ) : query.isError && list.length === 0 ? (
          <ErrorState
            message="片单加载失败，可能是上游源响应慢或本地代理没开，点重试再拉一次"
            onRetry={() => void query.refetch()}
            className="py-20"
          />
        ) : groups.length === 0 ? (
          <EmptyState title="该分类暂无内容" description="换个子类或稍后再试" />
        ) : (
          <>
            <div className="text-xs text-faint mb-3">
              共 {total} 部 · 已加载 {list.length} 部
              {(sort !== 'new' || areaActive) && (
                <span className="ml-1">
                  （取自最近更新的 {total} 部
                  {areaActive && '，按地区筛选'}
                  {sort !== 'new' && (areaActive ? '、' : '') + (sort === 'hot' ? '按播放量排' : '按评分排')}
                  ）
                </span>
              )}
            </div>
            <Reveal>
              <div className="poster-grid">
                {groups.map((g) => (
                  <AggregatedCard key={g.key} group={g} onOpen={setDetailItem} showType={false} />
                ))}
              </div>
            </Reveal>

            {/* 上拉加载：哨兵自动续页 + 按钮兜底 */}
            <div ref={sentinelRef} className="h-4" aria-hidden />
            {query.hasNextPage ? (
              <div className="flex justify-center mt-6">
                <button
                  type="button"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                  className="btn-ghost text-sm flex items-center gap-2"
                >
                  {query.isFetchingNextPage && <Spinner size="sm" />}
                  {query.isFetchingNextPage ? '加载中…' : '加载更多'}
                </button>
              </div>
            ) : (
              <p className="text-center text-xs text-faint py-6">已展示全部 {list.length} 部</p>
            )}
            {query.isError && list.length > 0 && (
              <div className="flex justify-center pb-6">
                <button
                  type="button"
                  onClick={() => void query.fetchNextPage()}
                  className="btn-ghost text-sm"
                >
                  加载失败，点此重试
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <SiteFooter />
      <BackToTop />
      <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}
