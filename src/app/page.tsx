'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Header } from '@/components/header';
import { RecommendSection } from '@/components/douban-section';
import { DetailModal } from '@/components/detail-modal';
import { AggregatedCard, aggregateResults } from '@/components/video-card';
import { PosterSkeleton } from '@/components/states';
import { Reveal } from '@/components/reveal';
import { CATEGORY_ORDER, CATEGORY_TO_SLUG } from '@/lib/categories';
import {
  useAppStore,
  resolveSource,
  isInDisabledSubscription,
  rankSourcesByHealth,
  toHealthHints,
} from '@/lib/store';
import { api } from '@/lib/client-api';
import type { SearchResultItem, SourceSearchOutcome } from '@/lib/types';
import { SearchHistoryDropdown, useSearchHistory } from '@/components/search-history';
import { cn, validateSourceUrl } from '@/lib/utils';
import { useToast } from '@/components/toast';
import { EmptyState } from '@/components/states';
import { Icon } from '@/components/icon';
import { SiteFooter } from '@/components/site-footer';

/**
 * 首页：搜索（URL ?s= 驱动，可后退/分享）+ 豆瓣推荐。
 * 搜索状态由 React Query 管理，失败源在结果区顶部以非阻塞方式展示。
 */
/** 搜索结果分批渲染的批大小：一次挂载上千张卡片会明显掉帧 */
const RESULT_PAGE_SIZE = 60;

/**
 * 热门搜索词来源（用户 2026-10-17 定，顺序即展示顺序，与首页滑轨对齐）：
 * 热播剧集 / 高分电影 / 热播电影 / 电影周榜 / 国产剧周榜 / 海外剧周榜 / 百度热播剧 的榜首真片名。
 * 除「热播电影」走豆瓣标签流（/api/douban）外，其余走 hot-list 接口；
 * queryKey 与首页横滑榜一致，React Query 自动共享缓存，不产生重复请求。
 */
const HOT_KEYWORD_SOURCES: { key: string; source: 'hot' | 'douban' }[] = [
  { key: 'douban_tv_hot', source: 'hot' }, // 热播剧集
  { key: 'douban_movie_score', source: 'hot' }, // 高分电影
  { key: 'douban_hot_movie', source: 'douban' }, // 热播电影（豆瓣标签流）
  { key: 'douban_movie_weekly', source: 'hot' }, // 电影周榜
  { key: 'douban_tv_chinese', source: 'hot' }, // 国产剧周榜
  { key: 'douban_tv_global', source: 'hot' }, // 海外剧周榜
  { key: 'baidu_teleplay', source: 'hot' }, // 百度热播剧
];

/** 单个来源的榜首词：请求中显骨架，失败/空则跳过不占位 */
function HotKeywordPill({
  config,
  onPick,
}: {
  config: { key: string; source: 'hot' | 'douban' };
  onPick: (word: string) => void;
}) {
  const query = useQuery({
    // 热播电影与 douban-section 的滑轨同 key，直接复用其缓存
    queryKey: config.source === 'hot' ? ['hot-list', config.key] : ['douban', 'movie', '热门'],
    queryFn: ({ signal }) =>
      config.source === 'hot'
        ? api.hotList(config.key, signal)
        : api.douban('movie', '热门', 0, 24, signal),
    staleTime: 5 * 60_000,
  });
  const title = query.data?.items?.[0]?.title;
  if (query.isLoading) {
    return (
      <span className="inline-block h-9 w-20 rounded-pill bg-black/[0.04] dark:bg-white/5 ring-1 ring-black/[0.08] dark:ring-white/10" />
    );
  }
  if (!title) return null;
  return (
    <button
      type="button"
      title={title}
      onClick={() => onPick(title)}
      className={cn(
        'max-w-[11rem] px-4 py-1.5 rounded-pill text-sm',
        'bg-black/[0.04] dark:bg-white/5 ring-1 ring-black/[0.08] dark:ring-white/10',
        'text-muted hover:text-accent hover:ring-accent/40 active:scale-[0.98]',
        'transition-[color,box-shadow,transform] duration-700 ease-swift'
      )}
    >
      <span className="block truncate">{title}</span>
    </button>
  );
}

export default function HomePage() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const urlQuery = searchParams.get('s') || '';
  // 精确订阅所需字段（对齐 live 页的做法）：搜索流式期间逐源写健康度、
  // 打开设置抽屉/历史面板等无关 store 变化，都不应触发首页整树重渲染
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const sourceHealth = useAppStore((s) => s.sourceHealth);
  const subscriptions = useAppStore((s) => s.subscriptions);
  const [input, setInput] = useState(urlQuery);
  const [detailItem, setDetailItem] = useState<SearchResultItem | null>(null);
  // 同组其他源条目：首选源（暴风）详情无剧集时，详情弹窗提供换源兜底
  const [detailAlternatives, setDetailAlternatives] = useState<SearchResultItem[]>([]);
  /** 流式搜索中已结算的源（data 就绪前用于增量渲染） */
  const [streamedOutcomes, setStreamedOutcomes] = useState<SourceSearchOutcome[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // URL 驱动搜索：?s= 变化时回填输入框
  useEffect(() => {
    if (urlQuery) setInput(urlQuery);
  }, [urlQuery]);

  // 源名回显：失败/停用提示里显示友好名称而非裸 key
  const sourceName = (key: string) =>
    customAPIs.find((a) => a.key === key)?.name ??
    envSources.find((a) => a.key === key)?.name ??
    key;

  const selectedSources = useMemo(() => {
    // selectedKeys 可能含历史残留的重复 key：按 key 去重，避免同源重复搜索
    const seen = new Set<string>();
    const resolved = selectedKeys
      .map((key) => resolveSource({ customAPIs, envSources }, key))
      .filter((s): s is NonNullable<typeof s> => {
        if (!s || !validateSourceUrl(s.url) || seen.has(s.key)) return false;
        seen.add(s.key);
        return true;
      })
      // 所属订阅被整体停用的源跳过（用户主动行为，各源勾选状态保留，重新启用即恢复）
      .filter((s) => !isInDisabledSubscription({ subscriptions }, s.key));
    // 按健康度排序：成功源前置（提权）、连续失败源后置（降权），但都不踢出搜索
    return rankSourcesByHealth(resolved, sourceHealth);
  }, [customAPIs, envSources, selectedKeys, sourceHealth, subscriptions]);
  // 来自已关闭订阅的源：勾选状态还在，但本次搜索用不到，必须明确告知
  const offSubscriptionSources = useMemo(
    () => selectedKeys.filter((key) => isInDisabledSubscription({ subscriptions }, key)),
    [selectedKeys, subscriptions]
  );

  const searchQuery = useQuery({
    queryKey: ['search', urlQuery, selectedKeys, yellowFilter],
    // 与 runSearch 的截断规则保持一致：顶栏搜索 / 手动构造长链接不会绕过上限
    queryFn: ({ signal }) => {
      setStreamedOutcomes([]);
      return api.search(urlQuery.slice(0, 100), selectedSources, yellowFilter, {
        signal,
        // 带上各源上次成败/耗时：后端据此在最终排序里提权降权（只调先后，不删结果）
        health: toHealthHints(sourceHealth),
        // 逐源结算即更新：结果边搜边渲染，同时滚动健康度（仅记录展示，不做任何停用）
        onSource: (outcome) => {
          setStreamedOutcomes((prev) => [...prev, outcome]);
          useAppStore.getState().recordSourceHealth([outcome]);
        },
      });
    },
    enabled: Boolean(urlQuery) && selectedSources.length > 0,
    // 5 分钟内从播放页返回时直接使用缓存，不重新搜索（服务端另有 60s 结果缓存兜底）
    staleTime: 300_000,
  });

  // 最近搜索改为搜索框下拉（聚焦展开、按输入过滤），不再常驻首屏
  const searchHistory = useSearchHistory(input);

  const runSearch = (q: string) => {
    const query = q.trim().slice(0, 100);
    if (!query) {
      toast('请输入搜索内容', 'info');
      inputRef.current?.focus();
      return;
    }
    if (selectedSources.length === 0) {
      toast('请先在设置中添加并勾选点播源', 'warning');
      return;
    }
    router.push(`/?s=${encodeURIComponent(query)}`, { scroll: false });
    searchHistory.record(query);
  };

  const pickHistory = (text: string) => {
    setInput(text);
    searchHistory.close();
    runSearch(text);
  };

  const isSearching = Boolean(urlQuery) && searchQuery.isFetching && !searchQuery.data;
  // 聚合数据未就绪时，用已结算源的结果增量渲染（健康源不再等坏源超时）
  const streamedList = useMemo(
    () => streamedOutcomes.flatMap((o) => o.list),
    [streamedOutcomes]
  );
  const list = useMemo(
    () => searchQuery.data?.list ?? (isSearching ? streamedList : []),
    [searchQuery.data, isSearching, streamedList]
  );
  const failures =
    searchQuery.data?.failures ??
    streamedOutcomes
      .filter((o) => !o.ok)
      .map((o) => ({ sourceKey: o.sourceKey, error: o.error || '请求失败', timedOut: o.timedOut }));
  // 跨源同名聚合：同名影片合并为一张卡片，展开后可选择具体来源
  const groups = useMemo(() => aggregateResults(list), [list]);

  // 分批渲染：新一次搜索（groups 变化）时重置回首批
  const [visibleCount, setVisibleCount] = useState(RESULT_PAGE_SIZE);
  const visibleGroups = useMemo(() => groups.slice(0, visibleCount), [groups, visibleCount]);
  useEffect(() => setVisibleCount(RESULT_PAGE_SIZE), [groups]);

  /*
   * 搜索胶囊：Double-Bezel（外壳留边 + 内芯承载输入区，同心圆角）。
   * Bento 左块与「有搜索」单行态共用同一份；两处互斥渲染，不会同时挂载 ref。
   */
  const searchBox = (
    <div ref={searchHistory.containerRef} className="relative w-full max-w-2xl">
      <form
        className="w-full"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(input);
        }}
      >
        {/* 外壳：p-1.5 留出托盘边；展开时底边改直，与下方浮层拼成同一面板 */}
        <div
          className={cn(
            'bezel transition-[border-radius,box-shadow] duration-700 ease-swift focus-within:shadow-glow',
            searchHistory.visible && 'rounded-b-none'
          )}
        >
          {/* 内芯：输入框与按钮合并，内部无边框，焦点态由外壳统一表达 */}
          <div
            className={cn(
              'bezel-core flex items-stretch min-h-12 pl-4 transition-[border-radius] duration-700 ease-swift',
              searchHistory.visible && 'rounded-b-none'
            )}
          >
            <input
              ref={inputRef}
              className="flex-1 min-w-0 pr-2 bg-transparent text-sm text-content placeholder:text-faint focus:outline-none"
              placeholder="输入影片名称..."
              value={input}
              maxLength={100}
              onChange={(e) => {
                setInput(e.target.value);
                searchHistory.resetActive();
              }}
              onFocus={searchHistory.onFocus}
              onKeyDown={(e) => searchHistory.onKeyDown(e, pickHistory)}
              role="combobox"
              aria-label="搜索影片"
              aria-expanded={searchHistory.visible}
              aria-controls="home-search-history"
              aria-autocomplete="list"
              aria-activedescendant={
                searchHistory.visible && searchHistory.activeIndex >= 0
                  ? `home-search-history-${searchHistory.activeIndex}`
                  : undefined
              }
            />
            {input && (
              <button
                type="button"
                className="shrink-0 self-center mr-1 p-1.5 rounded-pill text-faint hover:text-content hover:bg-black/5 dark:hover:bg-white/10 transition-colors duration-700 ease-swift"
                onClick={() => {
                  setInput('');
                  searchHistory.resetActive();
                  inputRef.current?.focus();
                }}
                aria-label="清空"
              >
                <Icon name="close" className="w-4 h-4" />
              </button>
            )}
            {/* 提交按钮贴合内芯右端：右圆角取内芯值、左侧直角；
                按压用亮度反馈（缩放会让贴合边缘露出缝隙） */}
            <button
              type="submit"
              className={cn(
                'btn-primary shrink-0 px-5 font-medium !rounded-l-none !rounded-r-core',
                'transition-[background-color,filter] active:brightness-90',
                searchHistory.visible && '!rounded-br-none'
              )}
            >
              <Icon name="search" className="w-4 h-4" />
              搜索
            </button>
          </div>
        </div>
      </form>

      {/* 最近搜索：与输入框无缝拼接；浮层不占文档流，出现/消失不会顶动下方内容 */}
      {searchHistory.visible && (
        <SearchHistoryDropdown
          id="home-search-history"
          matches={searchHistory.matches}
          activeIndex={searchHistory.activeIndex}
          onPick={pickHistory}
          onRemove={searchHistory.remove}
          onClearAll={searchHistory.clearAll}
        />
      )}
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="relative flex-1 max-w-shell w-full mx-auto px-5 md:px-8">
        {/*
          首屏氛围：只保留一团品牌青蓝光斑（原来还有紫 / 粉两团，属 AI 生成 hero 的标配模板，
          且多色叠加会与海报抢色）。hidden md:block —— 移动端的大半径 blur 会持续触发合成，掉帧。
        */}
        {!urlQuery && (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[600px] -z-10 overflow-hidden">
            <div
              className="hidden md:block absolute -top-40 left-1/2 -translate-x-1/2 w-[880px] h-[880px] rounded-full opacity-0 dark:opacity-45 blur-3xl animate-glow-drift"
              style={{ background: 'radial-gradient(circle, rgba(0,184,230,0.5), transparent 62%)' }}
            />
            <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[rgb(var(--c-page))]" />
          </div>
        )}

        {/*
          搜索区：无搜索时走非对称 Bento —— 左 7 列承载主张与搜索框，右 5 列三个错落 tile
          （self-end 让右列底部对齐，打破对称）。有搜索时收成单行，把纵向空间全留给结果。
          右侧 tile 只用站内既有数据（分类常量 + 榜单路由），不新增请求、不暴露任何源信息。
        */}
        {!urlQuery ? (
          <section className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8 pt-10 md:pt-20 pb-10 md:pb-16">
            <div className="md:col-span-7 flex flex-col justify-center">
              <p className="eyebrow w-fit mb-5">免费 · 聚合 · 即点即看</p>
              <h1 className="text-display-md md:text-display-lg font-display leading-none mb-5">
                <span className="brand-gradient">view163</span>
              </h1>
              <p className="text-sm sm:text-base text-muted max-w-md">
                免费搜索 · 聚合海量影视 · 即点即看，无需注册
              </p>
              <div className="mt-8">{searchBox}</div>
              {/* 热门词：桌面单行横滑（9 个 pill 在 7 列宽里换行会剩孤行），移动端允许换行 */}
              <div className="mt-6 flex flex-wrap md:flex-nowrap items-center gap-2 md:overflow-x-auto md:py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <span className="eyebrow shrink-0">热门</span>
                {HOT_KEYWORD_SOURCES.map((config) => (
                  <HotKeywordPill key={config.key} config={config} onPick={runSearch} />
                ))}
              </div>
            </div>

            {/* 右栏入口 Bento：外层用 div 承载（原来是 Link 嵌 Link，<a> 套 <a> 属非法 HTML，
                浏览器会强行拆开外层链接，DOM 结构错乱导致右侧 tile 错位） */}
            <div className="md:col-span-5 self-end grid grid-cols-2 gap-3 md:gap-4">
              <div className="col-span-2 bezel">
                <div className="bezel-core p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="eyebrow">分类速览</p>
                    <span className="text-2xs text-faint num">{CATEGORY_ORDER.length} 大分类</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {CATEGORY_ORDER.map((cat, i) => (
                      <Link
                        key={cat}
                        href={`/category/${CATEGORY_TO_SLUG[cat]}`}
                        className="flex items-center justify-between rounded-tile bg-black/[0.03] dark:bg-white/5 px-3 py-2.5 ring-1 ring-black/[0.06] dark:ring-white/[0.08] transition-[background-color,box-shadow] duration-700 ease-swift hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                      >
                        <span className="text-[15px] font-medium text-content">{cat}</span>
                        <span className="num text-2xs text-faint">0{i + 1}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>

              <Link
                href="/rank/douban_tv_hot"
                className="bezel group transition-transform duration-700 ease-swift hover:-translate-y-1 active:scale-[0.98]"
              >
                <div className="bezel-core p-4 h-full min-h-[8.5rem] flex flex-col justify-between">
                  <p className="eyebrow">热播剧集</p>
                  <div className="flex items-end justify-between gap-2">
                    <p className="font-display text-2xl font-bold text-content leading-none">正在热播</p>
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-black/[0.04] dark:bg-white/10 text-muted transition-[background-color,color,transform] duration-700 ease-swift group-hover:bg-accent group-hover:text-on-accent group-hover:translate-x-0.5">
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 6l6 6-6 6" />
                      </svg>
                    </span>
                  </div>
                </div>
              </Link>

              <Link
                href="/rank/douban_top250"
                className="bezel group transition-transform duration-700 ease-swift hover:-translate-y-1 active:scale-[0.98]"
              >
                <div className="bezel-core p-4 h-full min-h-[8.5rem] flex flex-col justify-between">
                  <p className="eyebrow">高分经典</p>
                  <div className="flex items-end justify-between gap-2">
                    <p className="font-display text-2xl font-bold text-content leading-none num">TOP 250</p>
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-black/[0.04] dark:bg-white/10 text-muted transition-[background-color,color,transform] duration-700 ease-swift group-hover:bg-accent group-hover:text-on-accent group-hover:translate-x-0.5">
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 6l6 6-6 6" />
                      </svg>
                    </span>
                  </div>
                </div>
              </Link>
            </div>
          </section>
        ) : (
          <section className="pt-8 mb-6">
            <h1 className="sr-only">view163 视频搜索</h1>
            {searchBox}
          </section>
        )}


        {/* 搜索结果 */}
        {urlQuery && (
          <section aria-label="搜索结果" className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="eyebrow w-fit mb-2">搜索结果</p>
                <h2 className="text-sm text-muted">
                  “<span className="text-content">{urlQuery}</span>” 的搜索结果
                  {isSearching ? (
                    <span className="text-faint">
                      （已就绪 {streamedOutcomes.length}/{selectedSources.length} 个源…）
                    </span>
                  ) : (
                    searchQuery.data && (
                      <span className="text-faint num">
                        （{groups.length} 部影片 · {list.length} 条结果
                        {failures.length > 0 && `，${failures.length} 个源失败`}）
                      </span>
                    )
                  )}
                </h2>
              </div>
            </div>

            {failures.length > 0 && (
              <div className="mb-3 text-xs bg-black/[0.04] dark:bg-white/5 ring-1 ring-black/[0.08] dark:ring-white/10 rounded-tile px-3 py-2 flex flex-wrap gap-x-3 gap-y-1">
                <span className="text-faint">{isSearching ? '以下源暂时无响应：' : '部分点播源请求失败：'}</span>
                {failures.map((f) => (
                  <span key={f.sourceKey} className={f.timedOut ? 'text-warning' : 'text-faint'}>
                    {f.timedOut ? '⏱' : '✗'} {sourceName(f.sourceKey)}
                    {f.timedOut ? ' 超时' : ''}
                  </span>
                ))}
              </div>
            )}

            {offSubscriptionSources.length > 0 && (
              <div className="mb-3 text-xs text-faint bg-black/[0.04] dark:bg-white/5 ring-1 ring-black/[0.08] dark:ring-white/10 rounded-tile px-3 py-2">
                {offSubscriptionSources.length} 个源所属的订阅已停用，未参与本次搜索（在设置 → 数据源订阅中可重新启用）：
                {offSubscriptionSources.map((key) => sourceName(key)).join('、')}
              </div>
            )}

            {selectedSources.length === 0 ? (
              <NoSourceGuide hasSources={customAPIs.length > 0 || envSources.length > 0} />
            ) : list.length > 0 ? (
              <>
                <div className="poster-grid">
                  {visibleGroups.map((group) => (
                    <AggregatedCard
                      key={group.key}
                      group={group}
                      onOpen={(item, alternatives) => {
                        setDetailItem(item);
                        setDetailAlternatives(alternatives ?? []);
                      }}
                    />
                  ))}
                </div>
                {groups.length > visibleCount && (
                  <div className="flex justify-center mt-8">
                    {/* Button-in-Button：尾部箭头嵌在自己的小圆里，hover 时斜向位移 */}
                    <button
                      className="group btn-ghost rounded-pill px-6 py-3 active:scale-[0.98]"
                      onClick={() => setVisibleCount((v) => v + RESULT_PAGE_SIZE)}
                    >
                      加载更多（还有 <span className="num">{groups.length - visibleCount}</span> 部）
                      <span className="ml-2 inline-flex items-center justify-center w-8 h-8 rounded-pill bg-black/5 dark:bg-white/10 transition-transform duration-700 ease-swift group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                        <Icon name="chevronDown" className="w-4 h-4" />
                      </span>
                    </button>
                  </div>
                )}
              </>
            ) : isSearching ? (
              <PosterSkeleton count={12} />
            ) : (
              <EmptyState
                icon="search"
                title="没有找到匹配的结果"
                description="请尝试其他关键词或更换点播源"
                className="!py-16"
              />
            )}
          </section>
        )}

        {/* 首页推荐（有搜索时隐藏）：按分类横向滑轨分区 */}
        {!urlQuery && (
          <Reveal className="mt-14">
            <RecommendSection
              onPick={(title) => {
                setInput(title);
                runSearch(title);
              }}
            />
          </Reveal>
        )}
      </main>

      <SiteFooter />

      <DetailModal
        item={detailItem}
        alternatives={detailAlternatives}
        onPickAlternative={(item) => {
          setDetailItem(item);
          setDetailAlternatives((prev) => prev.filter((x) => x !== item));
        }}
        onClose={() => {
          setDetailItem(null);
          setDetailAlternatives([]);
        }}
      />
    </div>
  );
}

/** 无点播源 / 未勾选点播源时的引导（替代旧版首屏静默空白） */
function NoSourceGuide({ hasSources = false }: { hasSources?: boolean }) {
  return (
    <div className="bezel max-w-lg mx-auto">
      <div className="bezel-core p-10 text-center">
        <h3 className="text-content font-medium mb-2">{hasSources ? '尚未勾选点播源' : '先添加一个点播源'}</h3>
      <p className="text-sm text-muted leading-relaxed">
        {hasSources ? (
          <>点击右上角「设置」，勾选要参与搜索的点播源后重新搜索。</>
        ) : (
          <>
            view163 不内置任何采集站。点击右上角「设置 → 添加 API」，填入一个
              Apple CMS 采集站地址（如{' '}
              <code className="text-accent text-xs">https://example.com/api.php/provide/vod</code>），
              勾选后即可开始搜索。
            </>
          )}
        </p>
      </div>
    </div>
  );
}
