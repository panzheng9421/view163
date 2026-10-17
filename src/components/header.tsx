'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeToggle } from './theme';
import { SourceManagerDrawer } from './source-manager';
import { HistoryPanel } from './history-panel';
import { requestShowDownloadManager } from './download-manager';
import { Icon } from './icon';
import { SearchHistoryDropdown, useSearchHistory } from './search-history';
import { cn } from '@/lib/utils';
import { CATEGORY_ORDER, CATEGORY_TO_SLUG } from '@/lib/categories';

/** 顶部导航：Logo、分类导航、搜索框（首页外）、历史、设置 */
export function Header({ showSearch = false }: { showSearch?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  // 当前停留的一级分类（用于顶栏高亮）：/category/movie → 'movie'
  const activeCatSlug = pathname.startsWith('/category/') ? pathname.split('/')[2] : null;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  // 与首页搜索框共用同一套「最近搜索」下拉逻辑
  const searchHistory = useSearchHistory(query);

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
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur border-b border-line">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/" aria-label="view163 首页" className="flex items-center shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-512.png" alt="view163" className="w-7 h-7 rounded-lg" />
          </Link>

          {/* 主导航：一级分类平铺，点击进入 /category/<slug>，由分类页渲染二级子类 */}
          <nav className="hidden md:flex items-center gap-0.5">
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

          <div className="flex-1 sm:hidden" />

          <nav className="flex items-center gap-1 ml-auto">
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
            {/* 窄屏：主导航在 md 以下收进汉堡菜单（分类另走下方横滑条，一滑即达） */}
            <button
              className="md:hidden p-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
              aria-label="打开菜单"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span className="relative block w-5 h-3">
                <span
                  className={cn(
                    'absolute left-0 top-0 block h-px w-5 bg-content transition-transform',
                    menuOpen ? 'translate-y-[6px] rotate-45' : 'translate-y-[1px]'
                  )}
                />
                <span
                  className={cn(
                    'absolute left-0 bottom-0 block h-px w-5 bg-content transition-transform',
                    menuOpen ? '-translate-y-[6px] -rotate-45' : '-translate-y-[1px]'
                  )}
                />
              </span>
            </button>
          </nav>
        </div>

        {/* 手机端分类条：主导航在 md 以下收起，分类入口不能没有——第二行横滑，当前项高亮 */}
        <div className="md:hidden border-t border-line">
          <div className="max-w-6xl mx-auto px-4 h-11 flex items-center gap-1 overflow-x-auto scrollbar-thin [&>a]:shrink-0">
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
      </header>

      {/* 移动端菜单 */}
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-[60]">
          <div
            className="absolute inset-0 bg-black/70 animate-fade-in"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <nav className="relative h-full flex flex-col items-start justify-center gap-2 px-8">
            {[
              { href: '/', label: '首页' },
              { href: '/about', label: '关于' },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-2xl font-semibold text-content"
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
        'px-2.5 py-1.5 rounded-md text-sm transition-colors whitespace-nowrap',
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
