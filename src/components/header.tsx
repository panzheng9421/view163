'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeToggle } from './theme';
import { SourceManagerDrawer } from './source-manager';
import { HistoryPanel } from './history-panel';
import { requestShowDownloadManager } from './download-manager';
import { Icon } from './icon';
import { SearchHistoryDropdown, useSearchHistory } from './search-history';
import { cn } from '@/lib/utils';
import { CATEGORY_ORDER, CATEGORY_TO_SLUG } from '@/lib/categories';

/** 顶部导航：Logo、搜索框（首页外）、历史、设置 */
export function Header({ showSearch = false }: { showSearch?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  // 当前停留的一级分类（用于顶栏高亮）：/category/movie → 'movie'
  const activeCatSlug = pathname.startsWith('/category/') ? pathname.split('/')[2] : null;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState('');
  // 与首页搜索框共用同一套「最近搜索」下拉逻辑
  const searchHistory = useSearchHistory(query);

  const submitSearch = (text: string) => {
    const q = text.trim().slice(0, 100);
    if (!q) return;
    searchHistory.close();
    router.push(`/?s=${encodeURIComponent(q)}`, { scroll: false });
    // 顶栏搜索一并写入最近搜索（此前只有首页会记录）
    searchHistory.record(q);
  };

  const pickHistory = (text: string) => {
    setQuery(text);
    submitSearch(text);
  };

  return (
    <>
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur border-b border-line">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 h-14 flex items-center gap-2 sm:gap-3">
          <Link href="/" aria-label="view163 首页" className="flex items-center gap-2 shrink-0">
            {/* 品牌图标：圆角方盒 + 播放三角，与首页 hero 同一套渐变 */}
            <span
              aria-hidden
              className="inline-flex items-center justify-center w-7 h-7 rounded-lg"
              style={{ background: 'linear-gradient(135deg, #00ccff 0%, #7c3aed 52%, #ff3c78 100%)' }}
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="#ffffff">
                <path d="M8.5 5.4v13.2c0 .62.68 1 1.2.67l10.2-6.6a.79.79 0 0 0 0-1.34L9.7 4.73A.79.79 0 0 0 8.5 5.4Z" />
              </svg>
            </span>
            <span className="hidden sm:inline text-lg font-extrabold tracking-tight leading-none brand-gradient">
              view163
            </span>
          </Link>

          {/* 手机端：分类并入同一行，整条顶栏只占一行；超宽时可横向滑动（滚动条隐藏） */}
          <nav
            aria-label="分类导航"
            className="flex md:hidden items-center gap-0.5 flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>a]:shrink-0"
          >
            <HeaderLink href="/" active={pathname === '/'} compact>
              首页
            </HeaderLink>
            {CATEGORY_ORDER.map((cat) => {
              const slug = CATEGORY_TO_SLUG[cat];
              return (
                <HeaderLink key={cat} href={`/category/${slug}`} active={activeCatSlug === slug} compact>
                  {cat}
                </HeaderLink>
              );
            })}
          </nav>

          {/* 主导航：与工具图标分组，置于品牌区右侧 */}
          <nav className="hidden md:flex items-center gap-0.5 ml-1">
            <HeaderLink href="/" active={pathname === '/'}>
              首页
            </HeaderLink>
            {/* 一级分类平铺：点击进入 /category/<slug>，由分类页渲染二级子类 */}
            {CATEGORY_ORDER.map((cat) => {
              const slug = CATEGORY_TO_SLUG[cat];
              return (
                <HeaderLink key={cat} href={`/category/${slug}`} active={activeCatSlug === slug}>
                  {cat}
                </HeaderLink>
              );
            })}
            <HeaderLink href="/about" active={pathname === '/about'}>
              关于
            </HeaderLink>
          </nav>

          {showSearch && (
            <form
              className="flex-1 max-w-xl hidden sm:block"
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch(query);
              }}
            >
              <div ref={searchHistory.containerRef} className="relative">
                <input
                  className={cn(
                    'input w-full h-9',
                    // 展开时：上圆角与外框沿用聚焦样式，底边改为内部分隔线，与下拉拼成同一面板
                    searchHistory.visible &&
                      'rounded-b-none border-accent border-b-line bg-surface-raised focus-visible:ring-0'
                  )}
                  aria-label="搜索影片"
                  placeholder="搜索影片..."
                  value={query}
                  maxLength={100}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    searchHistory.resetActive();
                  }}
                  onFocus={searchHistory.onFocus}
                  onKeyDown={(e) => searchHistory.onKeyDown(e, pickHistory)}
                  role="combobox"
                  aria-expanded={searchHistory.visible}
                  aria-controls="header-search-history"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    searchHistory.visible && searchHistory.activeIndex >= 0
                      ? `header-search-history-${searchHistory.activeIndex}`
                      : undefined
                  }
                />
                {searchHistory.visible && (
                  <SearchHistoryDropdown
                    id="header-search-history"
                    matches={searchHistory.matches}
                    activeIndex={searchHistory.activeIndex}
                    onPick={pickHistory}
                    onRemove={searchHistory.remove}
                    onClearAll={searchHistory.clearAll}
                  />
                )}
              </div>
            </form>
          )}

          <nav className="flex items-center gap-1 shrink-0 ml-auto">
            {/* 桌面端：关于 + 主题 + 下载管理 留在顶栏 */}
            <div className="hidden md:flex items-center gap-0.5">
              <HeaderLink href="/about" active={pathname === '/about'}>
                关于
              </HeaderLink>
            </div>
            <span className="hidden md:block w-px h-5 bg-line mx-1" />
            <div className="hidden md:flex items-center gap-1">
              <ThemeToggle />
              <IconButton label="下载管理" onClick={requestShowDownloadManager}>
                <Icon name="download" />
              </IconButton>
            </div>
            {/* 观看历史：两端都在顶栏、固定贴在设置齿轮左侧。
                手机端此前只有「设置 → 我的账号 → 我的内容」三层入口，太深，已上提到一级。 */}
            <IconButton label="观看历史" onClick={() => setHistoryOpen(true)}>
              <Icon name="clock" />
            </IconButton>
            <IconButton label="设置" onClick={() => setSettingsOpen(true)}>
              <Icon name="gear" />
            </IconButton>
          </nav>
        </div>
      </header>

      <SourceManagerDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

function HeaderLink({
  href,
  active,
  children,
  compact = false,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  /** 手机端单行顶栏用：更小的内边距与字号，给一行塞下五个分类 */
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-md transition-colors whitespace-nowrap',
        compact ? 'px-2 py-1.5 text-[13px]' : 'px-2.5 py-1.5 text-sm',
        active ? 'text-content bg-hover' : 'text-muted hover:text-content'
      )}
    >
      {children}
    </Link>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="p-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
