import type { Config } from 'tailwindcss';

/**
 * 语义化颜色 token：全部通过 CSS 变量驱动，支持亮暗主题切换。
 * 暗色 = OLED 中性黑（#050608 页面 / #0d0e11 面板 / #0a0b0e 卡片）+ 品牌青蓝 #00b8e6 单一强调色。
 * 另有 radius / shadow / fontSize / easing 四组 token，与 globals.css 的 --r-* / --sh-* 变量对应。
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: 'rgb(var(--c-page) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--c-surface) / <alpha-value>)',
          raised: 'rgb(var(--c-surface-raised) / <alpha-value>)',
        },
        card: 'rgb(var(--c-card) / <alpha-value>)',
        chip: 'rgb(var(--c-chip) / <alpha-value>)',
        hover: 'rgb(var(--c-hover) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        content: 'rgb(var(--c-content) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        faint: 'rgb(var(--c-faint) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          hover: 'rgb(var(--c-accent-hover) / <alpha-value>)',
        },
        // 光晕专用：与 accent 同色，可独立调 alpha 而不影响文字色
        glow: 'rgb(var(--c-accent-glow) / <alpha-value>)',
        // 语义状态色：随亮/暗主题切换，替代直接使用 red/green/amber 等调色板
        danger: {
          DEFAULT: 'rgb(var(--c-danger) / <alpha-value>)',
          hover: 'rgb(var(--c-danger-hover) / <alpha-value>)',
        },
        success: 'rgb(var(--c-success) / <alpha-value>)',
        warning: 'rgb(var(--c-warning) / <alpha-value>)',
        info: 'rgb(var(--c-info) / <alpha-value>)',
        rating: 'rgb(var(--c-rating) / <alpha-value>)',
        // accent 实心底上的文字色：亮色=白、暗色=深（青蓝底对白字对比度不足）
        'on-accent': 'rgb(var(--c-on-accent) / <alpha-value>)',
        // 实心状态底色（配白字），比语义色更深一档保证对比度
        'danger-solid': 'rgb(var(--c-danger-solid) / <alpha-value>)',
        'success-solid': 'rgb(var(--c-success-solid) / <alpha-value>)',
        'warning-solid': 'rgb(var(--c-warning-solid) / <alpha-value>)',
        'info-solid': 'rgb(var(--c-info-solid) / <alpha-value>)',
      },
      fontFamily: {
        // 英文/数字走 Geist，中文按字符回退到系统栈（PingFang / 微软雅黑）
        sans: [
          'var(--font-geist-sans)',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Source Han Sans SC"',
          '"Noto Sans CJK SC"',
          'system-ui',
          'sans-serif',
        ],
        display: ['var(--font-geist-sans)', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
      },
      borderRadius: {
        shell: 'var(--r-shell)', // 32px 双边框外壳
        core: 'var(--r-core)', // 26px 内芯（与外壳同心）
        card: 'var(--r-card)', // 20px 常规卡片
        tile: 'var(--r-tile)', // 14px 小格 / 剧集按钮
        pill: 'var(--r-pill)',
        input: 'var(--r-input)', // 12px 输入框
      },
      boxShadow: {
        glass: 'var(--sh-glass)',
        lift: 'var(--sh-lift)',
        modal: 'var(--sh-modal)',
        glow: 'var(--sh-glow)',
        // Soft Structuralism：多层低偏移叠加成高散射环境光，亮色下用它替代 1px 灰边
        soft: 'var(--sh-soft)',
        'soft-lg': 'var(--sh-soft-lg)',
      },
      fontSize: {
        // 替掉散落的 text-[10px] / text-[11px] 魔法值
        '2xs': ['0.625rem', { lineHeight: '0.875rem', letterSpacing: '0.02em' }],
        mini: ['0.6875rem', { lineHeight: '1rem' }],
        eyebrow: ['0.625rem', { lineHeight: '1', letterSpacing: '0.2em', fontWeight: '500' }],
        'display-sm': ['2.25rem', { lineHeight: '1.05', letterSpacing: '-0.02em', fontWeight: '700' }],
        'display-md': ['3rem', { lineHeight: '1.02', letterSpacing: '-0.025em', fontWeight: '700' }],
        'display-lg': ['3.75rem', { lineHeight: '1', letterSpacing: '-0.03em', fontWeight: '800' }],
      },
      transitionTimingFunction: {
        swift: 'cubic-bezier(0.32, 0.72, 0, 1)',
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // 滚动进场：位移 + 去模糊，只动 transform / opacity / filter
        'reveal-up': {
          from: { opacity: '0', transform: 'translateY(4rem)', filter: 'blur(12px)' },
          to: { opacity: '1', transform: 'none', filter: 'none' },
        },
        // 菜单展开的交错遮罩揭示
        'mask-reveal': {
          from: { opacity: '0', transform: 'translateY(3rem)' },
          to: { opacity: '1', transform: 'none' },
        },
        // 骨架屏扫光：只动 transform，不触发重排
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'glow-drift': { '0%,100%': { opacity: '0.55' }, '50%': { opacity: '0.8' } },
      },
      animation: {
        'fade-in': 'fade-in 200ms cubic-bezier(0.32,0.72,0,1)',
        'slide-up': 'slide-up 320ms cubic-bezier(0.32,0.72,0,1)',
        'reveal-up': 'reveal-up 700ms cubic-bezier(0.32,0.72,0,1) both',
        'mask-reveal': 'mask-reveal 700ms cubic-bezier(0.32,0.72,0,1) both',
        shimmer: 'shimmer 1.6s cubic-bezier(0.32,0.72,0,1) infinite',
        'glow-drift': 'glow-drift 16s cubic-bezier(0.32,0.72,0,1) infinite',
      },
      // z-index 语义化：值沿用现状，只做命名，不改层级行为
      zIndex: {
        sticky: '40',
        drawer: '50',
        dropdown: '55',
        overlay: '60',
        modal: '70',
        confirm: '80',
        gate: '95',
        toast: '100',
      },
      maxWidth: {
        shell: '1360px', // 全站容器统一；1440 视口下留 40px 边距，避免内容贴边
      },
    },
  },
  plugins: [],
};

export default config;
