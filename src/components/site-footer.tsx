'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth';
import { CATEGORY_ORDER, CATEGORY_TO_SLUG } from '@/lib/categories';

/**
 * 全站统一页脚：品牌 + 分类导航 + 协议三列。
 * 上游的 GitHub 链接与版本检测已移除，版本号保留。
 */
export function SiteFooter() {
  const { version } = useAuth();
  return (
    <footer className="border-t border-line py-8">
      <div className="max-w-6xl mx-auto px-4 grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-6">
        <div className="md:col-span-5">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-512.png" alt="view163" className="w-7 h-7 rounded-lg" />
            <span className="text-lg font-bold text-content leading-none">view163</span>
          </div>
          <p className="mt-3 text-sm text-muted max-w-sm leading-relaxed">
            聚合全网影视资源，免费在线搜索与观看。本站不存储任何视频内容，仅提供信息索引。
          </p>
        </div>

        <nav className="md:col-span-4">
          <p className="text-xs font-medium text-faint mb-3">浏览</p>
          <div className="flex flex-col gap-2">
            <Link href="/" className="text-sm text-muted hover:text-content transition-colors">
              首页
            </Link>
            {CATEGORY_ORDER.map((cat) => (
              <Link
                key={cat}
                href={`/category/${CATEGORY_TO_SLUG[cat]}`}
                className="text-sm text-muted hover:text-content transition-colors"
              >
                {cat}
              </Link>
            ))}
            <Link
              href="/about"
              className="text-sm text-muted hover:text-content transition-colors"
            >
              关于
            </Link>
          </div>
        </nav>

        <div className="md:col-span-3 flex flex-col gap-2 md:items-end md:text-right">
          <p className="text-xs font-medium text-faint">关于</p>
          <p className="text-sm text-muted">AGPL-3.0 License</p>
          {version && <p className="text-sm text-faint">v{version}</p>}
          <p className="text-xs text-faint mt-2">内容版权归原权利人所有</p>
        </div>
      </div>
    </footer>
  );
}
