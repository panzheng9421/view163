'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { DoubanCard } from '@/components/video-card';
import { Header } from '@/components/header';
import { BackToTop } from '@/components/back-to-top';
import { SiteFooter } from '@/components/site-footer';
import { Spinner } from '@/components/states';
import type { DoubanItem } from '@/lib/types';

/** 每次上拉加载量：24 = 1 排 6 卡的整数倍（4 整行） */
const PAGE_SIZE = 24;

/**
 * 豆瓣标签流分区（PC 网页 search_subjects）的全部页。
 * 与 /rank/[id]（rexxar 官方榜）不同源，独立路由；
 * 豆瓣不返回 total，按「不足一页即到底」判断翻页终点。
 * key -> 分区配置（title 不出现「豆瓣」字样，遵守不露源规矩）
 */
const EXPLORE_MAP: Record<string, { title: string; type: 'movie' | 'tv'; tag: string }> = {
  'hot-movie': { title: '热播电影', type: 'movie', tag: '热门' },
  anime: { title: '动画新番', type: 'tv', tag: '日本动画' },
};

export default function ExplorePage() {
  return (
    <Suspense>
      <ExploreContent />
    </Suspense>
  );
}

function ExploreContent() {
  const params = useParams();
  const router = useRouter();
  const key = String(params?.key ?? '');
  const conf = EXPLORE_MAP[key];
  const valid = !!conf;

  const query = useInfiniteQuery({
    queryKey: ['douban-explore', key],
    queryFn: ({ pageParam = 0, signal }) =>
      api.douban(conf!.type, conf!.tag, pageParam, PAGE_SIZE, signal),
    initialPageParam: 0,
    // 豆瓣无 total：不足一页 = 到底
    getNextPageParam: (_lastPage, allPages) => {
      const last = allPages[allPages.length - 1];
      if (!last || last.items.length < PAGE_SIZE) return undefined;
      return allPages.reduce((n, p) => n + p.items.length, 0);
    },
    enabled: valid,
  });

  const items: DoubanItem[] = query.data?.pages.flatMap((p) => p.items) ?? [];
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 哨兵进入视口则自动加载下一页（按钮兜底，双保险）
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !query.hasNextPage || query.isFetchingNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void query.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage, items.length]);

  if (!valid) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 py-16 text-center">
          <p className="text-muted mb-4">分区不存在</p>
          <button className="btn-ghost text-sm" onClick={() => router.push('/')}>
            回首页
          </button>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <button
            type="button"
            aria-label="返回"
            onClick={() => router.back()}
            className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-line bg-surface text-muted hover:text-content hover:border-accent transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-content">{conf!.title}</h1>
        </div>

        {query.isError ? (
          <p className="text-sm text-faint py-16 text-center">内容加载失败，可稍后重试</p>
        ) : items.length === 0 && query.isLoading ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {items.map((item) => (
                <DoubanCard
                  key={item.id}
                  item={item}
                  onClick={() => router.push(`/?s=${encodeURIComponent(item.title)}`, { scroll: false })}
                />
              ))}
            </div>

            <div ref={sentinelRef} className="h-4" aria-hidden />

            {query.hasNextPage && (
              <div className="flex justify-center py-8">
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
            )}
            {!query.hasNextPage && items.length > 0 && (
              <p className="text-center text-xs text-faint py-8">已展示全部 {items.length} 部</p>
            )}
          </>
        )}
      </main>
      <SiteFooter />
      <BackToTop />
    </div>
  );
}
