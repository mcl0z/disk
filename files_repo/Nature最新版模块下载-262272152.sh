path="/sdcard/Nature模块更新"
if [ -d "$path" ]; then
  su -c "rm -R /sdcard/Nature模块更新"
fi
mkdir /sdcard/Nature模块更新
curl -o /sdcard/Nature模块更新/Nature最新版模块.zip https://vip.123pan.cn/1817353062/curl_download/update/Nature最新版模块.zip
echo "模块下载完成"
echo "模块文件路径:/sdcard/Nature模块更新"
echo "模块名称为:Nature最新版模块.zip"