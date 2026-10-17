'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * 统一弹窗外壳（Double-Bezel）：遮罩 + 外壳 + 内芯。
 *
 * 只负责「长得对、动画对」，不接管任何业务：role / aria / 焦点陷阱 / Esc / 滚动锁
 * 全部由调用方自己挂（透传的 props 会落到面板节点上），避免五个弹窗被迫共用一套生命周期。
 *
 * 性能护栏：backdrop-blur 只给遮罩（fixed），面板不加 blur；进场只动 opacity/transform/filter。
 */
export const ModalShell = forwardRef<
  HTMLDivElement,
  {
    /** 点击遮罩关闭；不传则点击遮罩无反应 */
    onClose?: () => void;
    /** 容器层（定位 / 滚动 / z-index） */
    className?: string;
    /** 面板外壳层（宽度、留白） */
    panelClassName?: string;
    /** 内芯层（真正承载内容，自带 bg-card 与同心圆角） */
    coreClassName?: string;
    children: React.ReactNode;
  } & React.HTMLAttributes<HTMLDivElement>
>(function ModalShell(
  { onClose, className, panelClassName, coreClassName, children, ...rest },
  ref
) {
  return (
    <div
      className={cn(
        'fixed inset-0 z-overlay flex items-start justify-center overflow-y-auto py-10 px-4',
        className
      )}
    >
      {/* 遮罩用 fixed：内容区滚动时它始终铺满，且 blur 只作用在 fixed 元素上 */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={cn('relative bezel w-full animate-reveal-up outline-none', panelClassName)}
        {...rest}
      >
        <div className={cn('bezel-core', coreClassName)}>{children}</div>
      </div>
    </div>
  );
});
