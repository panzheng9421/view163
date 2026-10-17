'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * 滚动进场：进入视口时执行「位移 + 去模糊」的揭示动画。
 *
 * 硬性约束（性能护栏）：
 * - 只动 transform / opacity / filter，绝不触发布局属性
 * - 用 IntersectionObserver，绝不用 window scroll 监听（那会造成连续回流、拖垮移动端）
 * - 禁止逐卡使用：60 张结果卡同时进场会掉帧，只在 section 级包裹
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  /** 交错延迟（毫秒），同一区块内多个 Reveal 依次出现时用 */
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 兜底：首屏内（含被 rootMargin 判定为「还没进」的区块）直接显示。
    // 否则 hydration 稍慢时 IO 回调可能迟到，用户会先看到一片空白，必须滚动才出现。
    if (el.getBoundingClientRect().top < window.innerHeight) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        'transition-[opacity,transform,filter] duration-700 ease-swift',
        shown ? 'opacity-100 translate-y-0 blur-0' : 'opacity-0 translate-y-16 blur-md',
        className
      )}
    >
      {children}
    </div>
  );
}
