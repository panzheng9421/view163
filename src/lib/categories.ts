import type { CategoryKey } from './types';

export interface SubCategory {
  name: string;
  /** 该源分类接口用的 type_id（Apple CMS 的 t= 参数） */
  t: number;
}

/**
 * 一级分类 → 各采集站的二级子类 type_id 映射。
 *
 * 匹配键是**源域名**而不是 source.key：预置源 key 是 `env_0`、订阅源是 `sub_xxx`、
 * 手动添加是 `custom_1`，都不是稳定的站名，只有域名（bfzyapi.com）才认得出是哪家站。
 *
 * 关键事实：bfzy 的「电影/电视剧/综艺/动漫」都是细分类型，没有单一大类 ID，
 * 因此每个一级分类由若干二级子类组成——点进一级分类后可在顶部切换子类，
 * 这也正好对应主流站点「二级分类」的体验。
 */
export const CATEGORY_MAP: Record<string, Partial<Record<CategoryKey, SubCategory[]>>> = {
  'bfzyapi.com': {
    电影: [
      { name: '动作片', t: 21 },
      { name: '喜剧片', t: 22 },
      { name: '恐怖片', t: 23 },
      { name: '科幻片', t: 24 },
      { name: '爱情片', t: 25 },
      { name: '剧情片', t: 26 },
      { name: '战争片', t: 27 },
      { name: '纪录片', t: 28 },
      { name: '电影解说', t: 51 },
    ],
    电视剧: [
      { name: '国产剧', t: 31 },
      { name: '欧美剧', t: 32 },
      { name: '香港剧', t: 33 },
      { name: '韩国剧', t: 34 },
      { name: '台湾剧', t: 35 },
      { name: '日本剧', t: 36 },
      { name: '泰国剧', t: 38 },
      { name: '短剧', t: 58 },
    ],
    综艺: [
      { name: '大陆综艺', t: 46 },
      { name: '港台综艺', t: 47 },
      { name: '日韩综艺', t: 48 },
      { name: '欧美综艺', t: 49 },
    ],
    动漫: [
      { name: '国产动漫', t: 40 },
      { name: '日韩动漫', t: 41 },
      { name: '欧美动漫', t: 42 },
      { name: '动画片', t: 50 },
      { name: 'AI漫剧', t: 74 },
    ],
  },
};

/** 一级分类展示顺序（顶栏平铺、分类页标题均按此顺序） */
export const CATEGORY_ORDER: CategoryKey[] = ['电影', '电视剧', '综艺', '动漫'];

/** 英文 slug → 中文一级分类（用作 URL 路径段，规避中文路径段兼容性） */
export const SLUG_TO_CATEGORY: Record<string, CategoryKey> = {
  movie: '电影',
  tv: '电视剧',
  variety: '综艺',
  anime: '动漫',
};

/** 中文一级分类 → 英文 slug（顶栏链接用） */
export const CATEGORY_TO_SLUG: Record<CategoryKey, string> = {
  电影: 'movie',
  电视剧: 'tv',
  综艺: 'variety',
  动漫: 'anime',
};

/** 取 URL 的 host（小写、去端口）；解析失败返回空串 */
function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase().replace(/:\d+$/, '');
  } catch {
    return '';
  }
}

/**
 * 分类页「地区」行选项（电影类目下展示）。
 * 严格对齐实测覆盖：源站 vod_area 本地归一化后，仅这几个地区在「近期 500 部」窗口里有足够内容
 * （内地 153 / 美国 136 / 中国香港 70 / 英国 31 / 中国台湾 29 / 印度 19 / 加拿大 11 / 韩国 10 / 日本 10）。
 * 标签名与后端 `areaTags()` 归一化结果完全一致；`全部` 表示不过滤。
 * 源站原始值 `香港/台湾/大陆` 一律由后端归一成 `中国香港/中国台湾/内地`（合规硬要求），UI 只认这里。
 */
export const AREA_OPTIONS: { label: string }[] = [
  { label: '全部' },
  { label: '内地' },
  { label: '美国' },
  { label: '中国香港' },
  { label: '英国' },
  { label: '中国台湾' },
  { label: '印度' },
  { label: '加拿大' },
  { label: '韩国' },
  { label: '日本' },
];

/**
 * 取某源在某一级分类下的二级子类列表。
 * 传入源的 URL（推荐）或 source.key 均可：先按 key 精确匹配，再按域名匹配。
 * 源无映射时返回 null，调用方据此提示「该源不支持分类浏览」。
 */
export function getSubCategories(sourceUrlOrKey: string, cat: CategoryKey): SubCategory[] | null {
  const byKey = CATEGORY_MAP[sourceUrlOrKey]?.[cat];
  if (byKey) return byKey;

  const host = hostOf(sourceUrlOrKey);
  if (!host) return null;
  for (const [domain, map] of Object.entries(CATEGORY_MAP)) {
    if (host === domain || host.endsWith(`.${domain}`)) return map[cat] ?? null;
  }
  return null;
}
