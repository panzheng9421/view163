'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon, type IconName } from './icon';

/**
 * 全站统一的状态呈现：加载中 / 空态 / 错误态。
 * 此前各处以 h-5/h-8/h-9 × border-2/3/4 的多种 spinner、
 * 「图标+标题」/「虚线框」/`❌` emoji / 纯文字四种空态混用，这里收敛为三个组件。
 */

const SPINNER_SIZE = {
  sm: 'w-4 h-4 border-2',
  md: 'w-8 h-8 border-4',
  lg: 'w-9 h-9 border-4',
} as const;

/**
 * 海报骨架屏：结构对齐真实结果卡（2:3 竖版海报 + 两行文字）。
 * 分类 / 榜单 / 探索三个新页面在首屏数据未就绪时使用。
 */
export function PosterSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 items-start">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg bg-card border border-line overflow-hidden">
          <div className="aspect-[2/3] bg-chip animate-pulse" />
          <div className="p-2.5 space-y-2">
            <div className="h-3.5 w-3/4 rounded bg-chip animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-chip animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Spinner({
  size = 'md',
  tone = 'default',
  className,
}: {
  size?: keyof typeof SPINNER_SIZE;
  /** onDark：播放器错误层等深色背景之上 */
  tone?: 'default' | 'onDark';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-block rounded-full animate-spin shrink-0',
        SPINNER_SIZE[size],
        tone === 'onDark' ? 'border-white/30 border-t-white' : 'border-line border-t-accent',
        className
      )}
      aria-hidden
    />
  );
}

/** 加载中：spinner + 可选文案（替代各处「纯文字 加载中...」） */
export function LoadingState({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-10', className)}>
      <Spinner size="md" />
      {label && <p className="text-sm text-muted">{label}</p>}
    </div>
  );
}

export function EmptyState({
  icon = 'link',
  title,
  description,
  action,
  /** boxed：虚线框引导（列表为空）；plain：单行文字（筛选无结果等） */
  variant = 'boxed',
  className,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: 'boxed' | 'plain';
  className?: string;
}) {
  if (variant === 'plain') {
    return <p className={cn('text-center text-xs text-faint py-6', className)}>{title}</p>;
  }
  return (
    <div className={cn('border border-dashed border-line rounded-lg p-6 text-center', className)}>
      <Icon name={icon} className="w-6 h-6 mx-auto text-faint mb-2" />
      <p className="text-sm text-muted">{title}</p>
      {description && <p className="text-xs text-faint mt-1 leading-relaxed">{description}</p>}
      {action && <div className="mt-3 flex items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  retryLabel = '重试',
  tone = 'default',
  className,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  tone?: 'default' | 'onDark';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-8 text-center', className)}>
      <Icon name="alert" className={cn('w-6 h-6', tone === 'onDark' ? 'text-white/80' : 'text-danger')} />
      <p className={cn('text-sm break-words max-w-md', tone === 'onDark' ? 'text-white/80' : 'text-muted')}>
        {message}
      </p>
      {onRetry && (
        <button
          className={cn('btn-ghost btn-sm', tone === 'onDark' && '!bg-white/10 !text-white !border-white/20')}
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
