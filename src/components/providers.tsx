'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { ToastProvider } from './toast';
import { AuthProvider } from './auth';
import { ThemeProvider } from './theme';
import { GlobalDownloadManager } from './download-manager';
import { DisclaimerModal } from './disclaimer-modal';
import { useAppStore, hydrateLiveProbeResults } from '@/lib/store';
import { fetchStatusWithRetry, STATUS_QUERY_KEY } from '@/lib/client-api';
import { applyEnvPresets } from '@/lib/subscription-sync';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000 },
        },
      })
  );

  // store 配置了 skipHydration：等挂载后再读 localStorage，
  // 保证 hydration 阶段客户端与服务端渲染结果一致。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 先等持久化状态恢复，再拉服务端下发数据：
      // 避免 setEnvSources/setLiveEnvSources 的勾选合并发生在 rehydrate 之前被覆盖。
      // rehydrate 失败（存量 localStorage 结构损坏等）不能连带跳过下面的预置源拉取，
      // 否则整站会「一个源都没有」，分类入口直接空掉。
      try {
        await Promise.resolve(useAppStore.persist.rehydrate());
      } catch {
        // 忽略：内存态仍可用，只是拿不到旧的勾选/健康度
      }
      if (cancelled) return;

      // 测活缓存从 IndexedDB 恢复（并顺带搬迁旧 localStorage 快照里的存量），
      // 与下面 /api/status 拉取互不依赖，失败静默
      void hydrateLiveProbeResults();

      // 拉取部署者通过 DEFAULT_SOURCES / DEFAULT_LIVE_SOURCES 预置的源。
      // 重试写在 queryFn 内部（见 fetchStatusWithRetry）：首屏这一拉失败会让预置源
      // 整场会话缺失，而 envSources 不进 localStorage，没有第二次补拉的机会。
      try {
        const d = await queryClient.fetchQuery({
          queryKey: STATUS_QUERY_KEY,
          queryFn: () => fetchStatusWithRetry(6),
        });
        if (cancelled || !d) return;
        // 预置数据（DEFAULT_SOURCES / DEFAULT_LIVE_SOURCES / DEFAULT_SUBSCRIPTIONS）
        // 预置订阅要经鉴权接口拉取，首屏这次可能发生在登录之前而 401 静默失败；
        // 登录成功后由 AuthProvider 再调一次 applyEnvPresets 补齐（函数幂等）
        await applyEnvPresets(d);
      } catch {
        // 静默：分类页会自行再拉一次 /api/status 兜底
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          {/* 全站常驻：下载事件监听（enqueueDownload）依赖它存在——
              挂在 Header 里会让 /watch 等不渲染 Header 的页面派发的事件凭空丢失 */}
          <GlobalDownloadManager />
          {/* 首次访问「使用声明」确认门：点过写 localStorage，之后不再弹 */}
          <DisclaimerModal />
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
