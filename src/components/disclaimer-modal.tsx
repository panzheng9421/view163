'use client';

import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from './use-focus-trap';

/**
 * 首次访问「使用声明」弹窗（全站挂载于 Providers）。
 * 2026-10-17 加：对齐上游 LibreTV 的首次访问声明门，品牌文案换 view163。
 *
 * 语义：一次性确认门——点「我已了解并接受」写 localStorage 后永不再弹；
 * 不响应遮罩点击 / Esc（确认门必须显式点击按钮，避免误关后不再显示）。
 * 键名沿用 libretv-* 前缀（与 libretv-theme 等同族，属内部存储标识，不改）。
 */
const AGREED_KEY = 'libretv-disclaimer-agreed';

export function DisclaimerModal() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);

  // 挂载后读标记：已确认过则不渲染。延迟到 effect 里开，保证 SSR/首帧不出现，
  // 客户端 hydration 不会 mismatch
  useEffect(() => {
    try {
      if (localStorage.getItem(AGREED_KEY) !== '1') setOpen(true);
    } catch {
      // localStorage 不可用（隐私模式等）时每次访问都展示，不阻断使用
      setOpen(true);
    }
  }, []);

  // 打开期间锁定背景滚动（与详情弹窗一致）
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const agree = () => {
    try {
      localStorage.setItem(AGREED_KEY, '1');
    } catch {
      // 写不进去（隐私模式）则仅本次会话不再弹
    }
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 animate-fade-in"
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="bg-surface-raised rounded-xl w-full max-w-lg shadow-2xl animate-slide-up outline-none"
        role="dialog"
        aria-modal="true"
        aria-label="使用声明"
      >
        <div className="p-6">
          <h2 className="text-lg font-semibold text-content mb-3">使用声明</h2>
          <p className="text-sm text-muted leading-relaxed mb-4">
            欢迎使用 view163，在开始之前，请了解并同意以下条款：
          </p>
          <div className="space-y-3 text-sm text-muted leading-relaxed">
            <p>
              <span className="text-accent font-medium">免责声明：</span>
              view163 仅提供搜索引擎服务，不提供、制作、存储或转载任何视频内容，不对本站聚合的第三方站点及其内容负责。
            </p>
            <p>
              <span className="text-accent font-medium">访问须知：</span>
              用户在使用本站服务时，需遵守相关法律法规，不得利用本站从事侵权或违法行为。如有违反，本站将配合相关调查。
            </p>
            <p>
              <span className="text-accent font-medium">广告与赞助说明：</span>
              本站可能在界面中展示第三方广告或赞助商提供的推广内容，相关内容与本站无关，请自行甄别。
            </p>
          </div>
          <div className="flex justify-center mt-6">
            <button className="btn-primary px-8" onClick={agree}>
              我已了解并接受
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
