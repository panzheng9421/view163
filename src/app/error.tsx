'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { ErrorState } from '@/components/states';

/**
 * 路由段级错误边界：捕获页面渲染/数据异常，避免落到 Next 默认英文白屏。
 * 刻意不放 Header——它依赖 zustand store，若异常源正是 store 会二次崩溃。
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[LibreTV] 页面渲染异常:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex items-center justify-center px-4">
        <ErrorState
          message="页面出了点问题，请重试。若持续失败请返回首页。"
          onRetry={reset}
          retryLabel="重试"
        />
      </main>
      <footer className="border-t border-line py-4">
        <p className="text-center text-xs text-faint">
          问题持续存在？{' '}
          <Link href="/" className="hover:text-accent">
            返回首页
          </Link>
        </p>
        <p className="mt-1 text-center text-xs">
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-faint hover:text-muted transition-colors"
          >
            京ICP备2026052042号
          </a>
        </p>
      </footer>
    </div>
  );
}
