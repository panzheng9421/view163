import { NextResponse } from 'next/server';
import { isPasswordConfigured, sessionFromCookieHeader, AUTH_DISABLED } from './auth';

/** API Route 共享守卫：关闭鉴权时直接放行；否则未配置密码返回 503，未登录返回 401 */
export function guardRequest(req: Request): NextResponse | null {
  if (AUTH_DISABLED) return null;
  if (!isPasswordConfigured()) {
    return NextResponse.json(
      { error: '服务器未设置 PASSWORD 环境变量' },
      { status: 503 }
    );
  }
  if (!sessionFromCookieHeader(req.headers.get('cookie'))) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  return null;
}

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
