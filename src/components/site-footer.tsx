'use client';

import { useAuth } from '@/components/auth';
import { SITE_NAME } from '@/lib/site';

/** ICP 备案号（工信部规定：底部须展示且可点击跳转查询页） */
const ICP_NUMBER = '京ICP备2026052042号';

/** 工信部备案查询地址 */
const ICP_LOOKUP_URL = 'https://beian.miit.gov.cn/';

/** 全站统一页脚：产品名 + 版本号 + 开源协议 + ICP 备案号 */
export function SiteFooter() {
  const { version } = useAuth();
  return (
    <footer className="border-t border-line py-4">
      <p className="text-center text-xs text-faint">
        {SITE_NAME}
        {version ? ` v${version}` : ''}
        {' · '}
        AGPL-3.0 License
      </p>
      <p className="mt-1 text-center text-xs">
        <a
          href={ICP_LOOKUP_URL}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-faint hover:text-muted transition-colors"
        >
          {ICP_NUMBER}
        </a>
      </p>
    </footer>
  );
}