import type { SearchResultItem, SourceHealthHint, VideoDetail } from './types';

/**
 * Apple CMS（苹果CMS）资源站响应解析
 * 与旧版 js/api.js 逻辑对齐，迁移为纯函数以便单元测试。
 */

const M3U8_PATTERN = /\$https?:\/\/[^"'\s]+?\.m3u8/g;

const UA_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

export function cmsRequestHeaders(): Record<string, string> {
  return { ...UA_HEADERS };
}

/** 搜索响应 → 统一结果列表 */
export function parseSearchList(
  data: unknown,
  source: { key: string; name: string; url: string; isAdult?: boolean }
): SearchResultItem[] {
  if (!data || typeof data !== 'object') throw new Error('API返回的数据格式无效');
  const list = (data as { list?: unknown }).list;
  // 部分源站无结果时返回 list: null（而非 []），视为空结果而非格式错误
  if (list !== null && list !== undefined && !Array.isArray(list)) {
    throw new Error('API返回的数据格式无效');
  }
  return (Array.isArray(list) ? list : []).map((item) => {
    const vod = item as Record<string, unknown>;
    return {
      sourceKey: source.key,
      sourceName: source.name,
      vodId: String(vod.vod_id ?? ''),
      name: String(vod.vod_name ?? ''),
      pic: typeof vod.vod_pic === 'string' ? vod.vod_pic : undefined,
      typeName: typeof vod.type_name === 'string' ? vod.type_name : undefined,
      year: typeof vod.vod_year === 'string' ? vod.vod_year : undefined,
      area: typeof vod.vod_area === 'string' ? vod.vod_area : undefined,
      remarks: typeof vod.vod_remarks === 'string' ? vod.vod_remarks : undefined,
      actor: typeof vod.vod_actor === 'string' ? vod.vod_actor : undefined,
      director: typeof vod.vod_director === 'string' ? vod.vod_director : undefined,
      sourceUrl: source.url,
      isAdult: source.isAdult,
      hits: num(vod.vod_hits),
      score: num(vod.vod_score),
    };
  });
}

/** 宽松取数：源站有的把数字写成字符串，取不到返回 undefined（不当作 0） */
function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * 从 vod_play_url 中提取分集地址：格式 源1$$$源2，集1$URL1#集2$URL2。
 * 部分源（如量子 lziapi、非凡 ffzy）第一条线路是网页中转页（…/share/xxx，不可播），
 * 真实 m3u8 在后面的线路里，因此优先取包含 m3u8 直链的线路；均无 m3u8 时回退第一条。
 */
export function extractEpisodesFromPlayUrl(playUrl: string): string[] {
  if (!playUrl) return [];
  const groups = playUrl
    .split('$$$')
    .map((group) =>
      group
        .split('#')
        .map((ep) => {
          const parts = ep.split('$');
          return parts.length > 1 ? parts[1] : '';
        })
        .filter((url) => url.startsWith('http://') || url.startsWith('https://'))
    )
    .filter((eps) => eps.length > 0);
  if (groups.length === 0) return [];
  return groups.find((eps) => eps.some((url) => url.includes('.m3u8'))) ?? groups[0];
}

/** 从简介文本中兜底提取 m3u8 链接 */
export function extractM3u8FromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(M3U8_PATTERN) || [];
  return matches.map((link) => link.replace(/^\$/, ''));
}

/** 详情 JSON 响应 → 统一详情 */
export function parseDetail(
  data: unknown,
  source: { key: string; name: string; url: string }
): VideoDetail {
  const d = data as { list?: Record<string, unknown>[] };
  if (!d || !Array.isArray(d.list) || d.list.length === 0) {
    throw new Error('获取到的详情内容无效');
  }
  const vod = d.list[0];
  let episodes = extractEpisodesFromPlayUrl(String(vod.vod_play_url ?? ''));
  if (episodes.length === 0) {
    episodes = extractM3u8FromText(String(vod.vod_content ?? ''));
  }
  return {
    episodes,
    videoInfo: {
      title: str(vod.vod_name),
      cover: str(vod.vod_pic),
      desc: str(vod.vod_content),
      typeName: str(vod.type_name),
      year: str(vod.vod_year),
      area: str(vod.vod_area),
      director: str(vod.vod_director),
      actor: str(vod.vod_actor),
      remarks: str(vod.vod_remarks),
      sourceKey: source.key,
      sourceName: source.name,
      sourceUrl: source.url,
    },
  };
}

function str(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || undefined;
}

/**
 * 部分源的列表接口不返回播放地址，需要爬详情页 HTML 提取 m3u8。
 * 与旧版 handleSpecialSourceDetail 对齐。
 */
export function parseDetailPageHtml(
  html: string,
  source: { key: string; name: string; url: string }
): VideoDetail {
  // 先尝试通用模式，再尝试非凡影视的日期哈希特征路径
  let matches = html.match(/\$(https?:\/\/[^"'\s]+?\.m3u8)/g) || [];
  if (matches.length === 0) {
    matches = html.match(/\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g) || [];
  }
  // 去重并清理尾缀
  const episodes = [...new Set(matches)].map((link) => {
    let u = link.substring(1);
    const parenIndex = u.indexOf('(');
    if (parenIndex > 0) u = u.substring(0, parenIndex);
    return u;
  });

  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const descMatch = html.match(/<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/);

  return {
    episodes,
    videoInfo: {
      title: titleMatch ? titleMatch[1].trim() : undefined,
      desc: descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').trim() : undefined,
      sourceKey: source.key,
      sourceName: source.name,
      sourceUrl: source.url,
    },
  };
}

/**
 * 敏感分类过滤（成人内容过滤）。只按分类名（typeName）匹配、不碰标题：
 * 采集站里「伦理」「写真热舞」这类分类名即成人向，而正常影视不会用它当分类，
 * 误杀正常内容的概率极低；反过来按标题关键词拦则容易误伤纪录片、社会新闻。
 *
 * 关键词一律写成「词根」而非完整分类名：源站同一分类在不同站叫「伦理」「伦理片」
 * 「日本伦理」都有（2026-10-18 用户报「伦理」标签漏过滤即是只写了「伦理片」之故）。
 */
const ADULT_KEYWORDS = [
  // 伦理（「理论」为部分源站的错别字变体，实测存在）
  '伦理', '倫理', '理论',
  '福利', '福利片', '福利视频', '日本福利', '擦边', '擦边短剧', '里番动漫',
  '门事件', '萝莉少女', '制服诱惑', '国产传媒', 'cosplay', '黑丝诱惑',
  '无码', '有码', '无码高清', '有码高清', 'swag', '网红主播', '色情片',
  '同性片', '91视频', '自拍偷拍', 'mini传媒',
  // 写真/热舞一族（用户 2026-10-18 报「桥本有菜」搜出大量写真热舞漏过滤后补）
  '写真', '写真集', '热舞', '秀人', '私房', '大尺度',
];

export function isAdultContent(typeName: string | undefined): boolean {
  if (!typeName) return false;
  // 去空白 + 小写化：源站分类名偶有「伦理 片」「Cosplay」「SWAG」这类空格/大小写变体
  const name = typeName.replace(/[\s\u3000]+/g, '').toLowerCase();
  return ADULT_KEYWORDS.some((k) => name.includes(k));
}

export function filterAdultResults<T extends { typeName?: string }>(items: T[], enabled: boolean): T[] {
  if (!enabled) return items;
  return items.filter((item) => !isAdultContent(item.typeName));
}

/**
 * 归一化标题/关键词：去空白、标点与符号，转小写。
 * 用于跨标点差异匹配（源站存「摔跤吧!爸爸」而用户搜「摔跤吧！爸爸」）。
 */
export function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/**
 * 相关性判断：结果标题是否真的命中了搜索词。
 * 部分采集站会做分词/OR 模糊搜索（搜「摔跤吧！爸爸」返回一堆「爸爸XXX」），
 * 逐条校验后只保留真正相关的结果。
 *
 * 规则：归一化后的标题包含归一化后的完整关键词；
 * 多词查询（空格分隔）时放宽为「每个词都命中」即可（如「钢铁侠 2008」）。
 */
export function isRelevant(name: string, wd: string): boolean {
  const nName = normalizeTitle(name);
  const nWd = normalizeTitle(wd);
  if (!nName || !nWd) return true; // 空关键词不参与过滤
  if (nName.includes(nWd)) return true;
  const tokens = wd.trim().split(/\s+/);
  if (tokens.length > 1) {
    return tokens.every((t) => {
      const n = normalizeTitle(t);
      return n && nName.includes(n);
    });
  }
  return false;
}

/**
 * 结果相关性过滤：丢弃与关键词无关的条目。
 * 过滤后为空时回退到原列表——宁可多展示也不把源站唯一可用的结果清空。
 */
export function filterRelevantResults<T extends { name?: string }>(items: T[], wd: string): T[] {
  const filtered = items.filter((item) => isRelevant(item.name || '', wd));
  return filtered.length > 0 ? filtered : items;
}

/** 优质版本标记：正片高清/完整资源，排序加分 */
const QUALITY_GOOD = /HD|高清|蓝光|BD|1080|4K|完结|已完结|全集|正片|中字/i;
/** 劣质版本标记：枪版/抢先/解说/预告等非正片，排序重扣（不删除，只沉底） */
const QUALITY_BAD = /TC|枪版|偷拍|抢版|抢先|路透|预告|解说|花絮|片段/i;

/**
 * 搜索结果相关度打分（2026-10-17 加，替代「精确同名排最前」的裸排序）。
 *
 * 背景：源站同一部片常有多个条目——如 2026 年《希望》同时存在
 * 「希望 / 更新至TC超清版」（枪版，与关键词完全同名）和「希望2026 / 更新至HD」（高清版，名字带年份）。
 * 旧排序只按「归一化后完全同名 → 名字 localeCompare」，枪版靠同名永远压着高清版，
 * 高清版反而因名字多个「2026」被甩到几十位开外。
 *
 * 打分：名称匹配度（同名 100 / 开头 80 / 包含 30）为主，
 * 版本质量（HD·完结 +25；TC·枪版·预告·解说 -80）决胜，
 * 年份新鲜度弱加权（2015 年后每年 +1，封顶 +10，避免老经典被新短剧反超）。
 * 同分保持旧语义：名字 localeCompare → 源名。
 */
export function scoreSearchResult(
  item: { name?: string; remarks?: string; year?: string | number },
  wd: string
): number {
  const nName = normalizeTitle(item.name || '');
  const nWd = normalizeTitle(wd);
  let score = 0;
  if (nName && nWd) {
    if (nName === nWd) score += 100;
    else if (nName.startsWith(nWd)) score += 80;
    else if (nName.includes(nWd)) score += 30;
  }
  const badge = `${item.name || ''} ${item.remarks || ''}`;
  if (QUALITY_BAD.test(badge)) score -= 80;
  else if (QUALITY_GOOD.test(badge)) score += 25;
  const year = Number(item.year);
  if (Number.isFinite(year) && year > 2015) score += Math.min(10, year - 2015);
  return score;
}

/** 上次成功的源在最终排序里的提权加分 */
const HEALTH_BONUS_OK = 8;
/** 每次连续失败的扣分：单次抖动只掉一小截，不至于被沉底 */
const HEALTH_PENALTY_PER_FAIL = 6;
/**
 * 健康度扣分上限。
 * 必须显著小于「同名 100 / 开头 80 / 包含 30」之间的档差（最小 50 分），
 * 否则一个坏源的「包含」结果会越过好源的「同名」结果，搜「甄嬛传」反而先出一堆不相干的。
 */
const HEALTH_PENALTY_CAP = 30;

/**
 * 源健康度 → 最终排序加权值（加在 scoreSearchResult 之上）。
 *
 * 为什么需要这一层：源列表顺序传到后端后，聚合排序会按相关度打分整体重排，
 * 同分时又按「标题 → 源名」兜底，rankSourcesByHealth 排出来的源顺序会被完全覆盖，
 * 光靠调整 sources 数组顺序起不到任何作用。要让降权/提权真的生效，必须折算进打分本身。
 *
 * - 上次成功 → 提权加分；
 * - 连续失败 → 按连击扣分，封顶；
 * - 无记录 → 0，不偏不倚。
 * 注意：这里只影响先后，绝不删除任何结果，源再差也照常参与搜索。
 */
export function healthWeight(hint?: SourceHealthHint): number {
  if (!hint) return 0;
  if (hint.ok) return HEALTH_BONUS_OK;
  const streak = Number.isFinite(hint.failStreak) ? Math.max(0, Number(hint.failStreak)) : 0;
  return -Math.min(HEALTH_PENALTY_CAP, streak * HEALTH_PENALTY_PER_FAIL);
}
