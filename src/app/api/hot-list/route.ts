import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchHotList, fetchHotListPage, isHotListId } from '@/lib/douban-weekly';

export const runtime = 'nodejs';

/**
 * 影视热榜：豆瓣五个周榜 + 百度热播剧（60s API 免 key）+ 豆瓣直连榜单
 * （高分经典 Top250 / 热播剧集）。服务端转发 + 内存缓存。
 * 带 start/count 参数时走分页模式（全部页「查看更多」），返回 { items, total }。
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const sp = new URL(req.url).searchParams;
  const id = sp.get('id') || '';
  if (!isHotListId(id)) {
    return NextResponse.json({ error: `未知榜单: ${id.slice(0, 30)}` }, { status: 400 });
  }

  const startRaw = sp.get('start');
  const countRaw = sp.get('count');
  const paged = startRaw !== null || countRaw !== null;

  try {
    if (paged) {
      const start = Math.max(0, Number.parseInt(startRaw ?? '0', 10) || 0);
      const count = Math.min(100, Math.max(1, Number.parseInt(countRaw ?? '24', 10) || 24));
      const { items, total } = await fetchHotListPage(id, start, count);
      return NextResponse.json({ items, total });
    }
    const items = await fetchHotList(id);
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '榜单获取失败' },
      { status: 502 }
    );
  }
}
