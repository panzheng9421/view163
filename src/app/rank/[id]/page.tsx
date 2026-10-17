'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { isDoubanRankId, RANK_TITLES } from '@/lib/douban-rank-shared';
import { DoubanCard } from '@/components/video-card';
import { Header } from '@/components/header';
import { BackToTop } from '@/components/back-to-top';
import { SiteFooter } from '@/components/site-footer';
import { Spinner, PosterSkeleton } from '@/components/states';
import type { DoubanItem } from '@/lib/types';

/** 每次上拉加载量：24 = 1 排 6 卡的整数倍（4 整行） */
const PAGE_SIZE = 24;

export default function RankPage() {
  return (
    <Suspense>
      <RankContent />
    </Suspense>
  );
}

function RankContent() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id ?? '');
  const valid = isDoubanRankId(id);
  const title = valid ? RANK_TITLES[id] : '';

  const query = useInfiniteQuery({
    queryKey: ['hot-list-rank', id],
    queryFn: ({ pageParam = 0, signal }) =>
      api.hotList(id, signal, { start: pageParam, count: PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.items.length, 0);
      const total = lastPage.total ?? loaded;
      return loaded < total ? loaded : undefined;
    },
    enabled: valid,
  });

  const items: DoubanItem[] = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
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
          <p className="text-muted mb-4">榜单不存在</p>
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
        <div className="flex items-center gap-3 pt-6">
          <button
            type="button"
            aria-label="返回"
            onClick={() => router.back()}
            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-chip text-muted hover:text-content hover:bg-hover transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-content truncate">{title}</h1>
          {total > 0 && <span className="ml-auto text-sm text-faint shrink-0">共 {total} 部</span>}
        </div>

        {query.isError ? (
          <p className="text-sm text-faint py-16 text-center">榜单加载失败，可稍后重试</p>
        ) : items.length === 0 && query.isLoading ? (
          <PosterSkeleton count={18} />
        ) : (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 items-start mt-6">
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
