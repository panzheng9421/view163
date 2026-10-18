import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';
import { CATEGORY_ORDER, CATEGORY_TO_SLUG } from '@/lib/categories';
import { DOUBAN_RANKS } from '@/lib/douban-rank-shared';

/**
 * /sitemap.xml —— 给搜索引擎与 AI 爬虫（Googlebot / ClaudeBot / BingBot 等）的页面清单。
 *
 * 为什么需要：爬虫靠内链也能发现页面，但深层页面爬不到、新页面无人知晓。
 * 站点日志里实测有 15 次 /sitemap.xml 请求（其中 14 次是 404），说明爬虫在找它。
 *
 * 只列「有固定 URL 的页面」。搜索结果页与片源详情页是动态生成的
 * （搜什么才出现什么，无稳定 URL），无法收录，故不列。
 */

/** 探索页 key（与 app/explore/[key]/page.tsx 的 EXPLORE_MAP 保持一致） */
const EXPLORE_KEYS = [
  { key: 'hot-movie', priority: 0.7 },
  { key: 'anime', priority: 0.7 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: '/', lastModified: now, changeFrequency: 'hourly', priority: 1 },
    { url: '/about', lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
  ];

  const categoryPages: MetadataRoute.Sitemap = CATEGORY_ORDER.map((cat) => ({
    url: `/category/${CATEGORY_TO_SLUG[cat]}`,
    lastModified: now,
    changeFrequency: 'hourly',
    priority: 0.9,
  }));

  const rankPages: MetadataRoute.Sitemap = Object.keys(DOUBAN_RANKS).map((id) => ({
    url: `/rank/${id}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.8,
  }));

  const explorePages: MetadataRoute.Sitemap = EXPLORE_KEYS.map(({ key, priority }) => ({
    url: `/explore/${key}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority,
  }));

  return [...staticPages, ...categoryPages, ...rankPages, ...explorePages].map((entry) => ({
    ...entry,
    url: `${SITE_URL}${entry.url}`,
  }));
}
