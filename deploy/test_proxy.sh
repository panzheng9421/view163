#!/bin/sh
echo "=== 10 源经 mihomo 7890 (code / 耗时) ==="
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
  r=$(curl -s -o /dev/null -w "%{http_code} %{time_total}s" --max-time 12 -x 127.0.0.1:7890 "$u" 2>/dev/null)
  label=$(echo "$u" | sed -E 's#https://([^/]+)/.*#\1#')
  echo "  $r  $label"
done
echo "=== 暴风 3 次连测(看稳定性/速度) ==="
i=1
while [ $i -le 3 ]; do
  r=$(curl -s -o /dev/null -w "%{http_code} %{time_total}s" --max-time 12 -x 127.0.0.1:7890 "https://bfzyapi.com/api.php/provide/vod?ac=videolist&wd=%E7%88%B1%E6%83%85&pg=1" 2>/dev/null)
  echo "  第${i}次: $r"
  i=$((i+1))
done
