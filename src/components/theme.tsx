'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * 主题上下文：light / dark / system，持久化到 localStorage。
 * 默认值按设备区分：手机/平板（纯触屏）深色，桌面跟随系统——
 * 影视站在小屏上深色观感更好，桌面用户沿用其操作系统偏好。
 * html 上的 .dark 类由 layout 中的内联脚本先行设置（避免首屏闪烁），此处负责后续切换。
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'libretv-theme';

/** 是否手机/平板这类纯触屏设备（只有它才默认深色，桌面一律跟随系统） */
function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  if (window.matchMedia('(pointer: coarse)').matches) return true;
  // 老内核不认 pointer 特性时 matches 恒为 false：用「窄屏 + 非精细指针」兜底。
  // 桌面窗口拖窄时 pointer: fine 为 true，因此不会被误判成手机
  return window.matchMedia('(max-width: 767px)').matches && !window.matchMedia('(pointer: fine)').matches;
}

/** 未手动设置过主题时的默认选择：触屏设备深色，桌面跟随系统（SSR 期无 window，回落 system） */
function defaultChoice(): ThemeChoice {
  return isTouchDevice() ? 'dark' : 'system';
}

/** 当前生效的选择：用户手动设置过以 localStorage 为准，否则走设备默认 */
function currentChoice(): ThemeChoice {
  return (localStorage.getItem(STORAGE_KEY) as ThemeChoice | null) || defaultChoice();
}

interface ThemeContextValue {
  theme: ThemeChoice;
  resolved: 'light' | 'dark';
  setTheme: (t: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  resolved: 'dark',
  setTheme: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(choice: ThemeChoice): 'light' | 'dark' {
  const resolved = choice === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : choice;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  return resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // 初始值固定 'system'：SSR 无 window，若这里就用 defaultChoice() 会让首帧图标
  // 与服务端 HTML 不一致（水合告警）；真实选择在下方 effect 里解析，html.dark 已由
  // layout 内联脚本在首屏前挂好，因此不存在闪烁
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const stored = currentChoice();
    setThemeState(stored);
    setResolved(apply(stored));

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      // 未手动设置过时，桌面端跟随系统偏好变化；手机端默认深色不随系统变
      if (!localStorage.getItem(STORAGE_KEY)) {
        setThemeState(defaultChoice());
        setResolved(apply(defaultChoice()));
      }
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((t: ThemeChoice) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
    setResolved(apply(t));
  }, []);

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>;
}

/** 亮暗切换按钮：在 light → dark → system 三态间循环 */
export function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();
  const next: ThemeChoice = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  const label = theme === 'system' ? '跟随系统（当前深色）' : theme === 'dark' ? '深色' : '浅色';
  const nextLabel = next === 'light' ? '浅色' : next === 'dark' ? '深色' : '跟随系统';

  return (
    <button
      className="p-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
      title={`主题：${label}，点击切换为${nextLabel}`}
      aria-label={`切换主题，当前 ${label}`}
      onClick={() => setTheme(next)}
    >
      {theme === 'system' ? (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ) : resolved === 'dark' ? (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      )}
    </button>
  );
}
