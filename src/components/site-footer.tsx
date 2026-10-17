'use client';

import { useAuth } from '@/components/auth';

/** 全站统一页脚：产品名 + 版本号 + 开源协议（已移除上游 GitHub 链接与版本检测） */
export function SiteFooter() {
  const { version } = useAuth();
  return (
    <footer className="border-t border-line py-4">
      <p className="text-center text-xs text-faint">
        view163{version ? ` v${version}` : ''}
        {' · '}
        AGPL-3.0 License
      </p>
    </footer>
  );
}
