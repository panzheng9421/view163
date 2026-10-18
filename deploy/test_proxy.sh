#!/bin/sh
echo "=== 10 源经 mihomo 7890 ==="
for u in \
  "https://bfzyapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1" \
  "https://360zy.com/api.php/provide/vod?ac=videolist&wd=test&pg=1" \
  "https://ikunzyapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1" \
  "https://jszyapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1" \
  "https://www.mdzyapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1" \
  "https://caiji.dyttzyapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1" \
  "https://ffzy5.tv/api.php/provide/vod?ac=videolist&wd=test&pg=1" \
  "https://api.apibdzy.com/api.php/provide/vod?ac=videolist&wd=test&pg=1" \
  "https://cj.rycjapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1" \
  "https://api.zuidapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1" ; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 12 -x 127.0.0.1:7890 "$u" 2>/dev/null)
  label=$(echo "$u" | sed -E 's#https://([^/]+)/.*#\1#')
  echo "  $code  $label"
done
echo "=== doh.pub 可达性 ==="
curl -s -o /dev/null -w "doh=%{http_code} t=%{time_total}s\n" --max-time 10 "https://doh.pub/dns-query?name=baidu.com&type=A" -H "accept: application/dns-json" 2>/dev/null || echo "doh.pub 不可达"
