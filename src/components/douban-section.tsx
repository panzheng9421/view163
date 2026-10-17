'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { DoubanItem } from '@/lib/types';
import { DoubanCard } from './video-card';

const HOT_MOVIE_RAIL = { title: '热播电影', type: 'movie', tag: '热门', moreHref: '/explore/hot-movie' } as const;
const ANIME_RAIL = { title: '动画新番', type: 'tv', tag: '日本动画', moreHref: '/explore/anime' } as const;

/**
 * 豆瓣推荐分区（PC 网页 search_subjects 标签流），每个分区一条横向滑轨。
 * 2026-10-17 瘦身：删「热播剧集」（与热榜模式 tv_hot 重名重复）、
 * 「豆瓣高分电影」（与高分电影 movie_score 同数据）、「高分剧集」（tv·豆瓣高分真空），
 * 只留热榜模式没有的两条：热播电影 / 动画新番。
 */
const DOUBAN_RAILS: { title: string; type: 'movie' | 'tv'; tag: string }[] = [
  HOT_MOVIE_RAIL,
  ANIME_RAIL,
];

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 影视热榜（60s API）：每个榜单一条滑轨，取前 5 个避免首屏请求过密 */
const HOT_RAILS = [
  { id: 'douban_movie_weekly', title: '电影周榜' },
  { id: 'douban_tv_chinese', title: '国产剧周榜' },
  { id: 'douban_tv_global', title: '海外剧周榜' },
  { id: 'douban_show_chinese', title: '国内综艺' },
  { id: 'baidu_teleplay', title: '百度热播剧' },
];

/** 豆瓣直连榜单：置于周榜之上（高分电影 + 热播剧集），带「查看更多」全部页入口。
 *  2026-10-17：原「高分经典」(top250) 太陈旧（前排全是 1993~2014 老片），
 *  换成「高分电影」(movie_score)——同源超集且带 2025/2026 新片。
 *  top250 的 id 注册保留（全部页 /rank/douban_top250 与热门搜索 pill 仍可用）。 */
const RANK_RAILS = [
  { id: 'douban_tv_hot', title: '热播剧集', moreHref: '/rank/douban_tv_hot' },
  { id: 'douban_movie_score', title: '高分电影', moreHref: '/rank/douban_movie_score' },
];

/** 首页推荐区：数据源由设置决定（豆瓣热门 / Bangumi 新番放送 / 影视热榜），各源均以横向滑轨分区呈现 */
export function RecommendSection({ onPick }: { onPick: (title: string) => void }) {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const recommendSource = useAppStore((s) => s.recommendSource);

  if (!doubanEnabled) return null;
  if (recommendSource === 'bangumi') return <BangumiRails onPick={onPick} />;
  if (recommendSource === 'hot-list') return <HotListRails onPick={onPick} />;
  return <DoubanRails onPick={onPick} />;
}

/** 豆瓣推荐：每个分类一条横向滑轨（标题与内容同排，向左可回看） */
function DoubanRails({ onPick }: { onPick: (title: string) => void }) {
  return (
    <>
      {DOUBAN_RAILS.map((rail) => (
        <DoubanRail key={`${rail.type}-${rail.tag}`} config={rail} onPick={onPick} />
      ))}
    </>
  );
}

function DoubanRail({
  config,
  onPick,
}: {
  config: { title: string; type: 'movie' | 'tv'; tag: string; moreHref?: string };
  onPick: (title: string) => void;
}) {
  const query = useQuery({
    queryKey: ['douban', config.type, config.tag],
    queryFn: ({ signal }) => api.douban(config.type, config.tag, 0, 24, signal),
  });

  return (
    <Rail
      title={config.title}
      items={query.data?.items ?? []}
      loading={query.isLoading}
      error={query.isError}
      onPick={onPick}
      moreHref={config.moreHref}
    />
  );
}

/** Bangumi 每日放送：今日与本周两条滑轨（一次请求全量日历） */
function BangumiRails({ onPick }: { onPick: (title: string) => void }) {
  const query = useQuery({
    queryKey: ['bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
  });

  // JS 的 getDay() 周日为 0；本项目的 weekday 约定为 1=周一 … 7=周日
  const today = new Date().getDay();
  const weekday = today === 0 ? 7 : today;
  const days = query.data?.days ?? [];
  const todayItems = days.find((d) => d.weekday === weekday)?.items ?? [];
  const weekItems = days.flatMap((d) => d.items);

  return (
    <>
      <Rail
        title={`今日新番 · ${WEEKDAYS[weekday - 1]}`}
        items={todayItems}
        loading={query.isLoading}
        error={query.isError}
        onPick={onPick}
      />
      <Rail
        title="本周全部新番"
        items={weekItems}
        loading={query.isLoading}
        error={query.isError}
        onPick={onPick}
      />
    </>
  );
}

/**
 * 影视热榜模式首页滑轨顺序（用户 2026-10-17 拍板）：
 * 热播剧集 → 高分电影 → 热播电影 → 60s 周榜们 → 动画新番（垫底）。
 * 「热播电影」「动画新番」是豆瓣标签流分区（/api/douban），
 * 与热播剧集/高分电影不同源，合并进本模式后设置里的三选一暂时保留（后续固定死再删）。
 */
function HotListRails({ onPick }: { onPick: (title: string) => void }) {
  return (
    <>
      {RANK_RAILS.map((rail) => (
        <HotListRail key={rail.id} config={rail} onPick={onPick} />
      ))}
      {/* 热播电影：紧跟高分电影之后（用户指定位置） */}
      <DoubanRail key={`${HOT_MOVIE_RAIL.type}-${HOT_MOVIE_RAIL.tag}`} config={HOT_MOVIE_RAIL} onPick={onPick} />
      {HOT_RAILS.map((rail) => (
        <HotListRail key={rail.id} config={rail} onPick={onPick} />
      ))}
      {/* 动画新番：垫底 */}
      <DoubanRail key={`${ANIME_RAIL.type}-${ANIME_RAIL.tag}`} config={ANIME_RAIL} onPick={onPick} />
    </>
  );
}

function HotListRail({
  config,
  onPick,
}: {
  config: { id: string; title: string; moreHref?: string };
  onPick: (title: string) => void;
}) {
  const query = useQuery({
    queryKey: ['hot-list', config.id],
    queryFn: ({ signal }) => api.hotList(config.id, signal),
  });

  return (
    <Rail
      title={config.title}
      items={query.data?.items ?? []}
      loading={query.isLoading}
      error={query.isError}
      onPick={onPick}
      moreHref={config.moreHref}
    />
  );
}

/**
 * 横向滑轨分区：左侧分区标题 + 右侧翻页按钮，内容为可横向滚动的海报卡片。
 * 按钮在触底/触顶时禁用，窄屏隐藏（直接手指滑动）。
 */
function Rail({
  title,
  items,
  loading,
  error,
  onPick,
  moreHref,
}: {
  title: string;
  items: DoubanItem[];
  loading: boolean;
  error: boolean;
  onPick: (title: string) => void;
  moreHref?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const sync = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    sync();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      el.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [sync, items.length, loading]);

  const page = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 240), behavior: 'smooth' });
  };

  return (
    <section aria-label={title} className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-content flex items-center gap-2">
          <span className="inline-block w-1 h-4 rounded-full bg-gradient-to-b from-accent to-fuchsia-500" />
          {title}
        </h2>
        <div className="hidden sm:flex items-center gap-1">
          <RailArrow dir="left" disabled={!canLeft} onClick={() => page(-1)} />
          <RailArrow dir="right" disabled={!canRight} onClick={() => page(1)} />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-faint py-6">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : loading ? (
        <RailSkeleton />
      ) : items.length === 0 ? (
        <p className="text-sm text-faint py-6">该分区暂无推荐内容</p>
      ) : (
        <div
          ref={scrollerRef}
          className="flex gap-3 overflow-x-auto scrollbar-thin snap-x snap-mandatory pb-2"
        >
          {items.map((item) => (
            <div key={item.id} className="w-[108px] sm:w-[124px] shrink-0 snap-start">
              <DoubanCard item={item} onClick={() => onPick(item.title)} />
            </div>
          ))}
          {moreHref && (
            <Link
              href={moreHref}
              className="w-[108px] sm:w-[124px] shrink-0 snap-start group"
              aria-label={`${title} 查看更多`}
            >
              <div className="aspect-[2/3] rounded-lg border border-dashed border-line bg-surface/60 flex flex-col items-center justify-center gap-2 transition-colors group-hover:border-accent group-hover:bg-chip">
                <span className="text-sm text-muted group-hover:text-content">查看更多</span>
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-muted group-hover:text-accent" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 6l6 6-6 6" />
                </svg>
              </div>
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

function RailArrow({ dir, disabled, onClick }: { dir: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === 'left' ? '向左滚动' : '向右滚动'}
      className={cn(
        'inline-flex items-center justify-center w-7 h-7 rounded-full border border-line bg-surface text-muted transition-colors',
        disabled ? 'opacity-40 cursor-not-allowed' : 'hover:text-content hover:border-accent'
      )}
    >
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}
        />
      </svg>
    </button>
  );
}

function RailSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="w-[108px] sm:w-[124px] shrink-0">
          <div className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />
          <div className="h-3 mt-2 rounded bg-chip animate-pulse" />
        </div>
      ))}
    </div>
  );
}
