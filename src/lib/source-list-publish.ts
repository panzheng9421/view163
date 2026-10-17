/**
 * 源列表发布：把本站源列表上传到第三方粘贴板，换回一个可直接当订阅地址用的 URL。
 *
 * 之所以必须走服务端：粘贴板的写接口普遍不带 CORS 头，浏览器直连会被拦；
 * 服务端还能顺带限制体积、把目标域名固定死（不给 SSRF 留口子）。
 *
 * 内容会落在公开可读的粘贴板上——这一点只能靠 UI 明确告知用户，技术上无法规避。
 */

export interface PublishResult {
  url: string;
  /** 实际生效的粘贴板名称，便于告知用户「发布到了哪里」 */
  provider: string;
}

/** 内容体积上限：粘贴板普遍限制在数百 KB，而源列表正常只有几 KB */
export const MAX_PUBLISH_BYTES = 256 * 1024;

/** 单个粘贴板的等待上限，避免某个服务卡住把整次发布拖死 */
const TIMEOUT_MS = 15_000;

const USER_AGENT = 'view163/2.11';

interface Publisher {
  name: string;
  run(text: string, signal: AbortSignal): Promise<string>;
}

/**
 * 依次尝试的粘贴板，前一个失败自动换下一个。
 * 这些都是免费公共服务，随时可能收紧或失效，所以做成「多后端依次降级」而不是写死一家。
 */
const PUBLISHERS: Publisher[] = [
  {
    name: 'paste.rs',
    run: async (text, signal) => {
      const res = await fetch('https://paste.rs/', {
        method: 'POST',
        body: text,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'User-Agent': USER_AGENT },
        signal,
      });
      // 201 = 完整写入；206 = 超出服务端体积上限被截断，必须当失败处理，否则会发布出半个 JSON
      if (res.status !== 201) throw new Error(`HTTP ${res.status}`);
      const url = (await res.text()).trim();
      if (!/^https:\/\/paste\.rs\/[\w-]+$/.test(url)) throw new Error('返回内容不是有效链接');
      return url;
    },
  },
  {
    name: '0x0.st',
    run: async (text, signal) => {
      const form = new FormData();
      form.append('file', new Blob([text], { type: 'application/json' }), 'libretv-source-list.json');
      const res = await fetch('https://0x0.st', {
        method: 'POST',
        body: form,
        headers: { 'User-Agent': USER_AGENT },
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = (await res.text()).trim();
      if (!/^https:\/\/0x0\.st\/[\w.-]+$/.test(url)) throw new Error('返回内容不是有效链接');
      return url;
    },
  },
];

/** 依次尝试各粘贴板；全部失败时抛出带明细的错误，便于用户判断是网络问题还是服务挂了 */
export async function publishSourceList(text: string): Promise<PublishResult> {
  const errors: string[] = [];
  for (const publisher of PUBLISHERS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const url = await publisher.run(text, controller.signal);
      return { url, provider: publisher.name };
    } catch (err) {
      const reason = err instanceof Error ? (err.name === 'AbortError' ? '超时' : err.message) : '失败';
      errors.push(`${publisher.name}（${reason}）`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`发布失败：${errors.join('、')}`);
}
