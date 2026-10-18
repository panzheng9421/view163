/**
 * 站点规范域名（唯一来源）。
 *
 * 用途：sitemap / robots / OpenGraph / canonical 等需要绝对 URL 的地方。
 * 说明：view163.com 是固定对外域名（根域名），www 是同站别名；
 * 之前 www.view163.com 单独解析到本机，nginx 已把两个域名反代到同一应用。
 */

/** 规范域名（含协议，不带尾斜杠），用于生成绝对 URL */
export const SITE_URL = 'https://view163.com';

/** 站点名，用于 OpenGraph / schema 等 */
export const SITE_NAME = 'view163';

/** 站点一句话描述，与 layout.tsx 的 metadata.description 保持一致 */
export const SITE_DESCRIPTION =
  'view163 是一个免费的在线视频搜索平台，无广告、安全，提供来自多个视频源的内容搜索与观看服务，无需注册即可使用。';
