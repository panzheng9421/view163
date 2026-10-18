'use client';

import { useEffect } from 'react';

/**
 * iOS 视口复位保险（配合输入框 16px 字号使用）。
 *
 * 背景：iOS Safari 聚焦输入框时，若计算字号 < 16px 会强制放大页面；
 * 键盘收起后部分机型不触发 resize，视口停在放大态，表现为「画面被撑大、错位」。
 *
 * 字号已改到 16px + viewport maximumScale=1 属根治，本组件是最后一道保险：
 * 键盘收起（visualViewport 尺寸恢复）后，若视觉视口仍偏离布局视口，
 * 主动触发一次 resize 通知浏览器重新计算，避免停留在缩放态。
 *
 * 只读 visualViewport 宽高、不做任何写入，故不干扰正常的手势缩放。
 *
 * 必须是客户端组件：layout.tsx 是服务端组件，不能直接调用客户端 hook。
 */
export default function ViewportReset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let timer: number | undefined;

    const sync = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // 视觉视口宽高与布局视口比较，偏差 > 2% 视为仍处于缩放态
        const ratioW = window.innerWidth / vv.width;
        const ratioH = window.innerHeight / vv.height;
        if (ratioW > 1.02 || ratioH > 1.02 || vv.scale > 1.02) {
          window.dispatchEvent(new Event('resize'));
        }
      }, 120);
    };

    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      window.clearTimeout(timer);
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);

  return null;
}
