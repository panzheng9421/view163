'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeToggle } from './theme';
import { SourceManagerDrawer } from './source-manager';
import { HistoryPanel } from './history-panel';
import { requestShowDownloadManager } from './download-manager';
import { Icon } from './icon';
import { SearchHistoryDropdown, useSearchHistory } from './search-history';
import { cn } from '@/lib/utils';
import { CATEGORY_ORDER, CATEGORY_TO_SLUG } from '@/lib/categories';

/** 顶部导航：浮动玻璃胶囊（不贴顶、不通栏）、Logo、搜索框（首页外）、历史、设置 */
export function Header({ showSearch = false }: { showSearch?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  // 当前停留的一级分类（用于顶栏高亮）：/category/movie → 'movie'
  const activeCatSlug = pathname.startsWith('/category/') ? pathname.split('/')[2] : null;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pinned, setPinned] = useState(false);
  // 与首页搜索框共用同一套「最近搜索」下拉逻辑
  const searchHistory = useSearchHistory(query);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 滚动态：用 IntersectionObserver 观察顶部的哨兵元素，绝不用 window scroll 监听
  // （scroll 监听会造成连续回流，移动端直接掉帧）
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setPinned(!entry.isIntersecting), {
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 路由变化后收起移动端菜单
  useEffect(() => setMenuOpen(false), [pathname]);

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
      <div ref={sentinelRef} aria-hidden className="h-px" />
      {/*
        浮动胶囊：header 本身透明且不吃点击（pointer-events-none），
        只有胶囊本体可交互——这样页面内容能从胶囊两侧正常滚过。
      */}
      <header className="sticky top-2 z-sticky px-4 sm:px-6 md:px-8 pointer-events-none">
        <div
          className={cn(
            'pointer-events-auto max-w-shell mx-auto rounded-shell ring-1 backdrop-blur-xl',
            'ring-black/[0.08] dark:ring-white/10',
            'transition-[background-color,box-shadow] duration-700 ease-swift',
            pinned ? 'bg-surface/90 shadow-lift' : 'bg-surface/70 shadow-glass'
          )}
        >
          <div className="h-14 px-2 sm:px-4 flex items-center gap-3">
            <Link href="/" aria-label="view163 首页" className="flex items-center gap-2 shrink-0">
              {/* 品牌图标：圆角方盒 + 播放三角，与 icon.svg 同一组同色相青蓝 */}
              <span
                aria-hidden
                className="inline-flex items-center justify-center w-7 h-7 rounded-tile"
                style={{ background: 'linear-gradient(135deg, #00b8e6 0%, #0aa8d2 52%, #17bde4 100%)' }}
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="#ffffff">
                  <path d="M8.5 5.4v13.2c0 .62.68 1 1.2.67l10.2-6.6a.79.79 0 0 0 0-1.34L9.7 4.73A.79.79 0 0 0 8.5 5.4Z" />
                </svg>
              </span>
              <span className="hidden sm:inline text-lg font-display font-bold tracking-[-0.02em] leading-none brand-gradient">
                view163
              </span>
            </Link>

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
                      // 展开时：底边改为直线，与下拉拼成同一面板（下拉圆角须与输入框外壳一致，否则接缝错位）
                      searchHistory.visible && 'rounded-b-none bg-surface-raised focus-visible:ring-0'
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

            <div className="flex-1 sm:hidden" />

            <nav className="flex items-center gap-1 ml-auto">
              <span className="hidden md:block w-px h-5 bg-black/10 dark:bg-white/10 mx-1" />
              <ThemeToggle />
              <IconButton label="观看历史" onClick={() => setHistoryOpen(true)}>
                <Icon name="clock" />
              </IconButton>
              <IconButton label="下载管理" onClick={requestShowDownloadManager}>
                <Icon name="download" />
              </IconButton>
              <IconButton label="设置" onClick={() => setSettingsOpen(true)}>
                <Icon name="gear" />
              </IconButton>
              {/* 窄屏：主导航在 md 以下收进汉堡菜单（分类仍保留下方横滑条，一滑即达） */}
              <button
                className="md:hidden p-2 rounded-pill text-muted hover:text-content hover:bg-black/5 dark:hover:bg-white/10 transition-colors duration-700 ease-swift active:scale-[0.98]"
                aria-label="打开菜单"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <span className="relative block w-5 h-3">
                  {/* 两条线流动变形为 X：旋转 + 位移，不是直接消失 */}
                  <span
                    className={cn(
                      'absolute left-0 top-0 block h-px w-5 bg-content transition-transform duration-700 ease-swift',
                      menuOpen ? 'translate-y-[6px] rotate-45' : 'translate-y-[1px]'
                    )}
                  />
                  <span
                    className={cn(
                      'absolute left-0 bottom-0 block h-px w-5 bg-content transition-transform duration-700 ease-swift',
                      menuOpen ? '-translate-y-[6px] -rotate-45' : '-translate-y-[1px]'
                    )}
                  />
                </span>
              </button>
            </nav>
          </div>

          {/* 手机端分类条：主导航在 md 以下收起，分类入口不能没有——
              胶囊内第二行横滑（首页 + 四个一级分类），当前项高亮；桌面端不显示 */}
          <div className="md:hidden border-t border-black/[0.08] dark:border-white/10">
            <div className="h-11 px-2 flex items-center gap-1 overflow-x-auto scrollbar-thin [&>a]:shrink-0">
              <HeaderLink href="/" active={pathname === '/'}>
                首页
              </HeaderLink>
              {CATEGORY_ORDER.map((cat) => {
                const slug = CATEGORY_TO_SLUG[cat];
                return (
                  <HeaderLink key={cat} href={`/category/${slug}`} active={activeCatSlug === slug}>
                    {cat}
                  </HeaderLink>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      {/* 移动端菜单：全屏玻璃 + 交错遮罩揭示（各项依次上浮，不是一起弹出） */}
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-modal">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-3xl animate-fade-in"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <nav className="relative h-full flex flex-col items-start justify-center gap-2 px-8">
            {[
              { href: '/', label: '首页' },
              { href: '/about', label: '关于' },
            ].map((item, i) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-display-sm text-content animate-mask-reveal"
                // Tailwind 的 delay-* 只作用于 transition-delay，动画延迟必须走内联样式
                style={{ animationDelay: `${100 + i * 50}ms` }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}

      <SourceManagerDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

function HeaderLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'px-3 py-1.5 rounded-pill text-sm transition-colors duration-700 ease-swift',
        active
          ? 'text-content bg-black/5 dark:bg-white/10'
          : 'text-muted hover:text-content hover:bg-black/5 dark:hover:bg-white/10'
      )}
    >
      {children}
    </Link>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="p-2 rounded-pill text-muted hover:text-content hover:bg-black/5 dark:hover:bg-white/10 transition-colors duration-700 ease-swift active:scale-[0.98]"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
