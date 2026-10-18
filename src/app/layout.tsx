import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: {
    default: 'view163 - 免费在线视频搜索与观看平台',
    template: '%s - view163',
  },
  description:
    'view163 是一个免费的在线视频搜索平台，无广告、安全，提供来自多个视频源的内容搜索与观看服务，无需注册即可使用。',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      // SVG 优先：现代浏览器（标签页）优先采用，矢量任意缩放都清晰
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/icons/icon-96.png', sizes: '96x96', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#0b101a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 首屏前同步主题，避免亮暗闪烁。
            默认值：纯触屏设备（手机/平板，pointer:coarse）深色，桌面跟随系统；
            老内核不认 pointer 特性时用「窄屏 + 非精细指针」兜底（桌面窄窗 fine 恒为 true，不会误判）。
            用户手动切换过则以 localStorage 中的选择为准 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var m=function(q){return window.matchMedia?window.matchMedia(q).matches:false};var touch=m('(pointer: coarse)')||(m('(max-width: 767px)')&&!m('(pointer: fine)'));var t=localStorage.getItem('libretv-theme')||(touch?'dark':'system');var d=t==='dark'||(t==='system'&&m('(prefers-color-scheme: dark)'));document.documentElement.classList.toggle('dark',d);}catch(e){}})()",
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
