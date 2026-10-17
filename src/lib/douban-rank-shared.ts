/**
 * 豆瓣直连榜单的共享定义（纯常量，无任何依赖）。
 * 服务端（douban-rank.ts）与客户端（rank 全部页）都从这里取配置，
 * 避免客户端组件 import 服务端模块（其依赖链含 undici -> node:assert，
 * 会被 webpack 客户端编译炸掉）。
 */

/**
 * 直连榜单配置：豆瓣 collection slug、首页横滑条数、是否剧集。
 * railCount=24：1 排 6 卡的整数倍（横滑虽不换行，与分类页/全部页的每次量保持一致）。
 */
export const DOUBAN_RANKS = {
  douban_top250: { slug: 'movie_top250', railCount: 24, isTv: false },
  douban_tv_hot: { slug: 'tv_hot', railCount: 24, isTv: true },
  douban_movie_score: { slug: 'movie_score', railCount: 24, isTv: false },
} as const;

export type DoubanRankId = keyof typeof DOUBAN_RANKS;

export function isDoubanRankId(id: string): id is DoubanRankId {
  return id in DOUBAN_RANKS;
}

/** 榜单 id -> 展示名（不出现「豆瓣」字样，遵守不露源规矩） */
export const RANK_TITLES: Record<DoubanRankId, string> = {
  douban_top250: '高分经典',
  douban_tv_hot: '热播剧集',
  douban_movie_score: '高分电影',
};
