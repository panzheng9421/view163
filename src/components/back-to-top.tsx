'use client';

import { useEffect, useState } from 'react';

/** 回到顶部：滚动超过一屏才浮现，点击平滑回顶 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label="回到顶部"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={
        'fixed bottom-6 right-6 z-40 inline-flex h-10 w-10 items-center justify-center ' +
        'rounded-full bg-black/[0.04] dark:bg-white/5 ring-1 ring-black/[0.08] dark:ring-white/10 text-muted shadow-glass ' +
        'transition-[background-color,color,box-shadow,transform,opacity] duration-700 ease-swift hover:text-content hover:ring-accent/40 ' +
        (visible ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-2')
      }
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    </button>
  );
}
