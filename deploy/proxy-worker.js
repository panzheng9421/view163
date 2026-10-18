/**
 * view163 采集源反代 Worker
 *
 * 服务器上的 Node(undici) 直连源站会被 Cloudflare 按 TLS 指纹拦截（curl 通、Node 秒失败）。
 * 让服务器 Node 改连本 Worker，由 Worker 走 CF 边缘网络拉源站，绕过指纹拦截。
 *
 * 用法：https://<worker>/<真实host>/api.php/provide/vod?ac=videolist&t=6
 * 仅放行白名单 host，避免变成开放代理被刷。
 */

var HTTPS_HOSTS = [
  'bfzyapi.com',
  'cj.rycjapi.com',
  '360zy.com',
  'jszyapi.com',
  'www.mdzyapi.com',
  'api.zuidapi.com',
  'api.apibdzy.com',
  'ikunzyapi.com'
];
var HTTP_HOSTS = ['caiji.dyttzyapi.com', 'ffzy5.tv'];

var UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

var CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,HEAD,OPTIONS',
  'access-control-allow-headers': '*'
};

function jsonText(body, status) {
  return new Response(body, {
    status: status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' }
  });
}

async function handle(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  var url = new URL(request.url);
  var parts = url.pathname.split('/').filter(function (p) {
    return p.length > 0;
  });
  if (parts.length === 0) {
    return jsonText('view163 proxy ok. usage: /<host>/<path>', 200);
  }

  var host = parts[0].toLowerCase();
  var scheme = null;
  if (HTTPS_HOSTS.indexOf(host) >= 0) scheme = 'https';
  else if (HTTP_HOSTS.indexOf(host) >= 0) scheme = 'http';
  if (!scheme) {
    return jsonText('host not allowed: ' + host, 403);
  }

  var rest = '/' + parts.slice(1).join('/');
  var target = scheme + '://' + host + rest + url.search;

  var headers = new Headers();
  headers.set('Host', host);
  headers.set('User-Agent', UA);
  headers.set('Accept', request.headers.get('accept') || '*/*');
  if (request.headers.get('referer')) headers.set('Referer', request.headers.get('referer'));

  var init = { method: request.method, headers: headers, redirect: 'follow' };
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
    init.body = request.body;
  }

  try {
    var resp = await fetch(target, init);
    var out = new Headers(resp.headers);
    out.delete('content-security-policy');
    out.set('access-control-allow-origin', '*');
    return new Response(resp.body, { status: resp.status, headers: out });
  } catch (e) {
    return jsonText('proxy error: ' + String(e), 502);
  }
}

addEventListener('fetch', function (event) {
  event.respondWith(handle(event.request));
});
