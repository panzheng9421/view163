'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth';
import { CATEGORY_ORDER, CATEGORY_TO_SLUG } from '@/lib/categories';

/**
 * 全站统一页脚：三列 Editorial 版式（品牌 / 导航 / 协议）。
 * 上游的 GitHub 链接与版本检测已移除，版本号保留。
 */
export function SiteFooter() {
  const { version } = useAuth();
  return (
    <footer className="border-t border-black/[0.08] dark:border-white/10 py-12">
      <div className="max-w-shell mx-auto px-5 md:px-8 grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-6">
        <div className="md:col-span-5">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-flex items-center justify-center w-7 h-7 rounded-tile"
              style={{ background: 'linear-gradient(135deg, #00b8e6 0%, #0aa8d2 52%, #17bde4 100%)' }}
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="#ffffff">
                <path d="M8.5 5.4v13.2c0 .62.68 1 1.2.67l10.2-6.6a.79.79 0 0 0 0-1.34L9.7 4.73A.79.79 0 0 0 8.5 5.4Z" />
              </svg>
            </span>
            <span className="text-lg font-display font-bold tracking-[-0.02em] leading-none brand-gradient">
              view163
            </span>
          </div>
          <p className="mt-3 text-sm text-muted max-w-sm leading-relaxed">
            聚合全网影视资源，免费在线搜索与观看。本站不存储任何视频内容，仅提供信息索引。
          </p>
        </div>

        <nav className="md:col-span-4">
          <p className="eyebrow w-fit mb-3">浏览</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 max-w-[17rem]">
            <Link href="/" className="text-sm text-muted hover:text-content transition-colors duration-700 ease-swift">
              首页
            </Link>
            {CATEGORY_ORDER.map((cat) => (
              <Link
                key={cat}
                href={`/category/${CATEGORY_TO_SLUG[cat]}`}
                className="text-sm text-muted hover:text-content transition-colors duration-700 ease-swift"
              >
                {cat}
              </Link>
            ))}
            <Link
              href="/about"
              className="text-sm text-muted hover:text-content transition-colors duration-700 ease-swift"
            >
              关于
            </Link>
          </div>
        </nav>

        <div className="md:col-span-3 flex flex-col gap-2 md:items-end md:text-right">
          <p className="eyebrow w-fit">关于</p>
          <p className="text-sm text-muted">AGPL-3.0 License</p>
          {version && <p className="text-sm text-faint num">v{version}</p>}
          <p className="text-xs text-faint mt-2">内容版权归原权利人所有</p>
        </div>
      </div>
    </footer>
  );
}
