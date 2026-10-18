'use client';

import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';

export default function AboutPage() {
  const router = useRouter();
  // 从站内点进来就回上一页；直接打开本页（无历史）时回首页，避免点了没反应
  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/');
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-10 space-y-8">
        <section>
          <div className="flex items-center gap-1.5 mb-3">
            <button
              type="button"
              onClick={goBack}
              aria-label="返回"
              title="返回"
              className="-ml-2 p-1.5 rounded-md text-muted transition-colors hover:bg-hover hover:text-content"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-xl font-bold text-content">关于 view163</h1>
          </div>
          <p className="text-sm text-muted leading-relaxed">
            view163 是一个免费的在线视频搜索与观看平台。输入片名即可在多个点播源中聚合搜索，
            无需注册、无内嵌广告、不存储任何视频文件。所有播放内容均来自第三方公开接口。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">隐私与数据</h2>
          <p className="text-sm text-muted leading-relaxed">
            你的搜索历史、观看进度等数据仅保存在本设备浏览器中（IndexedDB），不会上传到服务器。
            聚合搜索请求由服务端代理转发，第三方数据源不会看到你的 IP 地址。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">免责声明</h2>
          <p className="text-sm text-faint leading-relaxed">
            本项目不存储、不制作任何视频内容，仅提供第三方公开接口的聚合与播放能力。
            请尊重版权，所有内容的合法性由对应数据源负责。
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
