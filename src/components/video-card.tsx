'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SearchResultItem } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { SmartImage } from './smart-image';

// —— 跨源同名聚合 ——

export interface AggregatedGroup {
  key: string;
  name: string;
  year?: string;
  typeName?: string;
  pic?: string;
  remarks?: string;
  score?: number;
  actor?: string;
  items: SearchResultItem[];
}

function buildGroup(name: string, year: string | undefined, items: SearchResultItem[]): AggregatedGroup {
  return {
    key: `${name}|${year ?? ''}|${items.map((i) => `${i.sourceKey}_${i.vodId}`).join(',')}`,
    name,
    year,
    typeName: items.find((i) => i.typeName)?.typeName,
    pic: items.find((i) => i.pic)?.pic,
    remarks: items.find((i) => i.remarks)?.remarks,
    score: items.find((i) => i.score)?.score,
    actor: items.find((i) => i.actor)?.actor,
    items,
  };
}

/**
 * 把扁平的跨源搜索结果按「同名影片」聚合：
 * - 以名称分桶；桶内年份不一致时（同名翻拍）按年份拆分，无年份的条目并入年份桶；
 * - 保持传入顺序（搜索结果已按名称排序）。
 */
export function aggregateResults(list: SearchResultItem[]): AggregatedGroup[] {
  const byName = new Map<string, SearchResultItem[]>();
  for (const item of list) {
    const k = (item.name || '').trim();
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(item);
  }
  const groups: AggregatedGroup[] = [];
  for (const [name, items] of byName) {
    const years = [...new Set(items.map((i) => i.year).filter(Boolean))] as string[];
    if (years.length > 1) {
      for (const y of years) {
        groups.push(buildGroup(name, y, items.filter((i) => i.year === y)));
      }
      const noYear = items.filter((i) => !i.year);
      if (noYear.length) groups.push(buildGroup(name, undefined, noYear));
    } else {
      groups.push(buildGroup(name, years[0], items));
    }
  }
  return groups;
}

/**
 * 确定性字符串哈希（FNV-1a）。
 * 用作评分小数位的种子：源站评分是整数精度，展示层补的小数必须
 * 同一部片每次渲染/刷新都一致，不能每次随机变。
 */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * 首选源域名（用户 2026-10-17 定：「这里就显示一个暴风就行了，暴风不能用再显示其他的」）：
 * 聚合卡片默认只出首选源的条目——有收录 → 点击直达其详情，不展开多源选择；
 * 首选源没收录这部片 → 保留全部条目走多源选择。
 * 按域名认源而非 env_N 下标：预置源增删/重排序后下标会漂，域名不会；
 * 首选源被用户整体删掉时自动回退为纯多源选择（优雅降级）。
 */
const PRIMARY_SOURCE_DOMAIN = 'bfzyapi.com';

/**
 * 聚合影片卡片（竖版海报卡，对齐主流影视站样式）：
 * - 海报占满卡片宽度（2:3），左上角年份、右下角评分叠加在图上；
 * - 海报下方：标题 + 类型胶囊 + 更新状态；
 * - 首选源（暴风）有收录 → 单源卡：点击直接打开该源详情（不带「N 源」徽章）；
 *   没收录 → 多源卡：显示「N 源」徽章，点击展开各源列表选源播放。
 * onOpen 第二参数传同组其他源条目：首选源详情无剧集时，详情弹窗据此提供换源兜底。
 */
export function AggregatedCard({
  group,
  onOpen,
  showType = true,
}: {
  group: AggregatedGroup;
  onOpen: (item: SearchResultItem, alternatives?: SearchResultItem[]) => void;
  /** 是否显示类型胶囊：分类页已选定分类，每卡再显示即冗余，传 false */
  showType?: boolean;
}) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [imgFailed, setImgFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const showImg = !!group.pic && !imgFailed;

  // 首选源有收录 → 卡片只留它（单源直达）；没收录 → 全部条目走多源选择
  const items = useMemo(() => {
    const primary = group.items.find((i) => (i.sourceUrl || '').includes(PRIMARY_SOURCE_DOMAIN));
    return primary ? [primary] : group.items;
  }, [group.items]);
  const multi = items.length > 1;
  const adult = useMemo(() => items.some((i) => i.isAdult), [items]);
  // 评分展示层规则（源站评分只有整数精度，实测 160 条 100% .0、10.0 占 10%）：
  // - 无数据或 6 分以下 → 「暂无评分」
  // - 10 分向下取精度 → 9.5~9.9
  // - 6/7/8/9 分 → 补一位确定性小数 x.0~x.9（种子=卡片 key，刷新不变）
  const scoreLabel = useMemo(() => {
    const s = group.score;
    if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0 || s < 6) return '暂无评分';
    const h = hashSeed(group.key);
    if (s >= 10) return (9.5 + (h % 5) / 10).toFixed(1);
    return `${Math.floor(s)}.${h % 10}`;
  }, [group.score, group.key]);

  // 演员行：源站原文「梁洛施 , 文俊辉 , 洪金宝」（中英文逗号 + 空格混杂），
  // 按逗号切开取前 3 个；字段为空（约 6%，多为刚上映新片）时不渲染整行
  const actorNames = useMemo(() => {
    if (!group.actor) return [];
    return group.actor
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
  }, [group.actor]);

  const activate = () => {
    if (multi) setExpanded((v) => !v);
    // 单源直达：把同组其他源作为备选带下去，详情无剧集时弹窗可换源
    else onOpen(items[0], group.items.filter((x) => x !== items[0]));
  };

  return (
    /*
     * 双边框（外壳 3px 托盘 + 内芯），hover 整体轻抬 4px。
     * 不用 hover:scale —— 外壳整体放大会把托盘边撑出比例，且相邻卡片互相挤压。
     */
    <div
      className={cn(
        'bezel-card group flex h-full flex-col transition-transform duration-700 ease-swift hover:-translate-y-1 active:scale-[0.98]',
        multi && expanded && 'ring-accent/40'
      )}
    >
      <div
        className="bezel-card-core flex flex-col flex-grow"
      >
      <div
        className="relative cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
        role="button"
        tabIndex={0}
        aria-expanded={multi ? expanded : undefined}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        }}
      >
        {showImg ? (
          <div className="relative aspect-[2/3] bg-chip">
            <SmartImage
              url={group.pic}
              mode={imageProxyMode}
              customProxy={customImageProxy}
              alt={group.name}
              className="absolute inset-0 h-full w-full object-cover"
              onExhausted={() => setImgFailed(true)}
            />
          </div>
        ) : (
          <div className="relative aspect-[2/3] bg-chip flex items-center justify-center">
            <svg className="w-8 h-8 text-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16m10-16v16M3 6a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm8 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6z" />
            </svg>
          </div>
        )}

        {/* 底部渐变：压暗海报下缘，保证叠加白字可读 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

        {/* 左上角：年份 */}
        {group.year && (
          <span className="absolute top-1.5 left-1.5 num text-mini font-medium text-white rounded-pill bg-black/60 px-2 py-0.5">
            {group.year}
          </span>
        )}

        {/* 右上角：多源数量徽章（只写数量，不出现源名） */}
        {multi && (
          <span className="absolute top-1.5 right-1.5 num text-mini text-accent font-medium rounded-pill bg-black/60 px-2 py-0.5 ring-1 ring-accent/30">
            {group.items.length} 源
          </span>
        )}

        {/* 右下角：评分（统一一位小数，对齐主流影视站） */}
        <span
          className={cn(
            'absolute bottom-1.5 right-1.5 num text-mini text-white rounded-pill bg-black/60 px-2 py-0.5',
            scoreLabel === '暂无评分' ? 'font-normal opacity-75' : 'font-bold ring-1 ring-rating/30'
          )}
        >
          {scoreLabel}
        </span>
      </div>

      {/* 文字区：标题 + 演员 + 类型胶囊(可选) + 更新状态 */}
      <div className="flex flex-col flex-grow min-w-0 p-3">
        <h3 className="font-medium tracking-[-0.01em] text-sm text-content line-clamp-2" title={group.name}>
          {group.name}
        </h3>
        {/* 演员行：无演员时保留等高空行（h-4），保证网格内多卡的文字行位置对齐 */}
        <p className="mt-0.5 text-mini text-muted truncate h-4" title={actorNames.join(' / ')}>
          {actorNames.join(' / ')}
        </p>
        {(showType && group.typeName) || adult ? (
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            {showType && group.typeName && (
              <span className="text-2xs px-2 py-0.5 rounded-pill bg-accent/10 text-accent ring-1 ring-accent/20">
                {group.typeName}
              </span>
            )}
            {adult && (
              <span className="text-2xs px-2 py-0.5 rounded-pill bg-danger/10 text-danger ring-1 ring-danger/25">
                (18+)
              </span>
            )}
          </div>
        ) : null}
        {group.remarks && (
          <p className="mt-1 text-mini text-muted line-clamp-1" title={group.remarks}>
            {group.remarks}
          </p>
        )}
      </div>

      {multi && expanded && (
        <div className="border-t border-black/[0.08] dark:border-white/10 p-3 animate-fade-in">
          <p className="text-2xs text-faint mb-2">选择来源播放</p>
          <div className="flex flex-wrap gap-1.5">
            {items.map((item, i) => (
              <button
                key={`${item.sourceKey}_${item.vodId}`}
                className={cn(
                  'group inline-flex items-center gap-1.5 max-w-full rounded-tile px-2.5 py-1.5',
                  'text-xs transition-[background-color,box-shadow,color] duration-700 ease-swift cursor-pointer',
                  'bg-black/[0.04] dark:bg-white/5 ring-1 ring-black/[0.08] dark:ring-white/10',
                  'hover:bg-accent/10 hover:ring-accent/40',
                  item.isAdult && 'ring-danger/30'
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(item, items.filter((x) => x !== item));
                }}
                aria-label={`播放 ${item.sourceName}`}
              >
                <span className="font-medium text-content truncate max-w-[9em]">{item.sourceName}</span>
                <span className="text-faint truncate max-w-[7em]">{item.remarks || '暂无介绍'}</span>
                {/* 斜向位移：比单纯放大更有「物理被推」的手感 */}
                <svg
                  className="w-3.5 h-3.5 text-accent shrink-0 transition-transform duration-700 ease-swift group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

/** 影片卡片：封面加载失败时逐级降级到占位图（未聚合的单一结果使用） */
export function VideoCard({ item, onClick }: { item: SearchResultItem; onClick: () => void }) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = !!item.pic && !imgFailed;

  return (
    <div
      className="card cursor-pointer hover:-translate-y-1 h-full transition-[transform,box-shadow] duration-700 ease-swift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          // 阻止空格触发页面滚动（AggregatedCard 已是此写法，此处对齐）
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex h-full">
        {showImg ? (
          <div className="relative flex-shrink-0 w-[105px] sm:w-[120px] aspect-[2/3] bg-chip">
            <SmartImage
              url={item.pic}
              mode={imageProxyMode}
              customProxy={customImageProxy}
              alt={item.name}
              className="h-full w-full object-cover"
              onExhausted={() => setImgFailed(true)}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent" />
          </div>
        ) : (
          <div className="flex-shrink-0 w-[105px] sm:w-[120px] aspect-[2/3] bg-chip flex items-center justify-center">
            <svg className="w-8 h-8 text-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16m10-16v16M3 6a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm8 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6z" />
            </svg>
          </div>
        )}

        <div className="p-2.5 flex flex-col flex-grow min-w-0">
          <div className="flex-grow">
            <h3 className="font-semibold text-sm text-content mb-1.5 line-clamp-2" title={item.name}>
              {item.name}
            </h3>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {item.typeName && (
                <span className="text-2xs px-2 py-0.5 rounded-pill bg-accent/10 text-accent ring-1 ring-accent/20">
                  {item.typeName}
                </span>
              )}
              {item.year && (
                <span className="num text-2xs px-2 py-0.5 rounded-pill bg-black/[0.04] dark:bg-white/5 text-muted ring-1 ring-black/[0.08] dark:ring-white/10">
                  {item.year}
                </span>
              )}
            </div>
            <p className="text-xs text-muted line-clamp-2 mb-2">{item.remarks || '暂无介绍'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 豆瓣推荐卡片（无来源徽章，点击直接搜索） */
export function DoubanCard({ item, onClick }: { item: { title: string; cover: string; rating?: string }; onClick: () => void }) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => setImgFailed(false), [item.cover]);

  return (
    <div
      className="bezel-card cursor-pointer hover:-translate-y-1 h-full transition-transform duration-700 ease-swift active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          // 阻止空格触发页面滚动（AggregatedCard 已是此写法，此处对齐）
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="bezel-card-core h-full flex flex-col">
        <div className="relative aspect-[2/3] bg-chip">
          {item.cover && !imgFailed ? (
            <SmartImage
              url={item.cover}
              mode={imageProxyMode}
              customProxy={customImageProxy}
              alt={item.title}
              className="w-full h-full object-cover"
              onExhausted={() => setImgFailed(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-chip">
              <svg className="w-8 h-8 text-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16m10-16v16M3 6a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm8 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6zm4 0a1 1 0 011-1h1a1 1 0 011 1v12a1 1 0 01-1 1h-1a1 1 0 01-1-1V6z" />
              </svg>
            </div>
          )}
          {item.rating && (
            <span className="absolute top-1.5 right-1.5 num text-mini text-rating font-medium rounded-pill bg-black/60 px-2 py-0.5 ring-1 ring-rating/30">
              ★ {item.rating}
            </span>
          )}
        </div>
        <div className="p-3">
          <div className="text-xs font-medium text-content truncate" title={item.title}>
            {item.title}
          </div>
        </div>
      </div>
    </div>
  );
}
