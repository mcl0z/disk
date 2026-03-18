#!/system/bin/sh

# Furnux Terminal Emulator Script
# 适用于安卓终端模拟器（完全兼容Android shell，无awk依赖）

# 设置脚本目录为根目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FURNUX_ROOT="$SCRIPT_DIR"
CURRENT_DIR="$FURNUX_ROOT"
CURRENT_USER="user"
FURRY_PASSWORD="iamafurry"
FURDO_PASSWORD="123456"
HOSTNAME="furnux"

# 颜色定义（使用ANSI转义码）
RED='\033[0;31m'
GREEN='\033[0;32m'
WHITE='\033[0;37m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 初始化文件系统
init_filesystem() {
    # 创建必要的目录
    mkdir -p "$FURNUX_ROOT/home/user" 2>/dev/null
    mkdir -p "$FURNUX_ROOT/root" 2>/dev/null
    mkdir -p "$FURNUX_ROOT/etc" 2>/dev/null
    mkdir -p "$FURNUX_ROOT/tmp" 2>/dev/null
    
    # 创建一些默认文件
    echo "Welcome to Furnux!" > "$FURNUX_ROOT/etc/motd" 2>/dev/null
    echo "furnux" > "$FURNUX_ROOT/etc/hostname" 2>/dev/null
}

# 检查命令是否在允许列表中
is_command_allowed() {
    cmd="$1"
    case "$cmd" in
        ls|cd|pwd|cp|mv|rm|mkdir|touch|cat|clear|df|du|free|uname|whoami|ping|ifconfig|wget|curl|help|furry|user|furdo|exit|info)
            return 0 ;;
        *)
            return 1 ;;
    esac
}

# 检查路径是否在根目录内
is_path_safe() {
    path="$1"
    # 获取真实路径
    if echo "$path" | grep -q "^/"; then
        # 绝对路径，直接检查
        full_path="$FURNUX_ROOT$path"
    else
        # 相对路径
        if [ "$path" = "." ]; then
            full_path="$CURRENT_DIR"
        elif [ "$path" = ".." ]; then
            full_path=$(dirname "$CURRENT_DIR")
        else
            full_path="$CURRENT_DIR/$path"
        fi
    fi
    
    # 规范化路径（移除多余的/和.）
    full_path=$(echo "$full_path" | sed 's#/\./#/#g' | sed 's#/\.$##')
    
    # 检查是否在根目录内
    case "$full_path" in
        "$FURNUX_ROOT"*)
            return 0 ;;
        *)
            return 1 ;;
    esac
}

# 转换为真实路径
get_real_path() {
    path="$1"
    if [ -z "$path" ]; then
        echo "$CURRENT_DIR"
        return
    fi
    
    if [ "$path" = "~" ]; then
        if [ "$CURRENT_USER" = "furry" ]; then
            echo "$FURNUX_ROOT/root"
        else
            echo "$FURNUX_ROOT/home/user"
        fi
        return
    fi
    
    if echo "$path" | grep -q "^/"; then
        # 绝对路径
        echo "$FURNUX_ROOT$path"
    elif [ "$path" = "." ]; then
        echo "$CURRENT_DIR"
    elif [ "$path" = ".." ]; then
        dirname "$CURRENT_DIR"
    else
        # 相对路径
        echo "$CURRENT_DIR/$path"
    fi
}

# 获取相对路径（用于显示）
get_relative_path() {
    real_path="$1"
    case "$real_path" in
        "$FURNUX_ROOT"*)
            rel_path="${real_path#$FURNUX_ROOT}"
            if [ -z "$rel_path" ]; then
                echo "/"
            else
                echo "$rel_path"
            fi
            ;;
        *)
            echo "$real_path" ;;
    esac
}

# 检查写权限
check_write_permission() {
    path="$1"
    target_path="$path"
    
    # 获取真实路径的目录部分
    if [ ! -e "$target_path" ]; then
        target_path=$(dirname "$target_path")
    fi
    
    if [ "$CURRENT_USER" = "furry" ]; then
        return 0
    else
        # 普通用户只能写家目录
        home_path="$FURNUX_ROOT/home/user"
        case "$target_path" in
            "$home_path"*)
                return 0 ;;
            "$FURNUX_ROOT"*)
                return 1 ;;
            *)
                return 1 ;;
        esac
    fi
}

# 获取家目录路径
get_home_path() {
    if [ "$CURRENT_USER" = "furry" ]; then
        echo "$FURNUX_ROOT/root"
    else
        echo "$FURNUX_ROOT/home/user"
    fi
}

# 处理ls命令
cmd_ls() {
    show_long=0
    human_readable=0
    target="."
    all_args="$*"
    
    # 解析参数（简单实现）
    for arg in $all_args; do
        case "$arg" in
            -l) show_long=1 ;;
            -h) human_readable=1 ;;
            -lh|-hl) show_long=1; human_readable=1 ;;
            -*)
                # 忽略其他选项
                ;;
            *)
                target="$arg"
                ;;
        esac
    done
    
    # 处理特殊路径
    if [ "$target" = "~" ]; then
        target="$(get_home_path)"
    else
        target=$(get_real_path "$target")
    fi
    
    # 检查路径是否存在
    if [ ! -e "$target" ]; then
        echo -e "${RED}无效目标！🐾${NC}"
        return 1
    fi
    
    # 获取相对路径用于显示
    rel_path=$(get_relative_path "$target")
    
    if [ $show_long -eq 1 ]; then
        # 长格式显示
        if [ -d "$target" ]; then
            # 列出目录内容
            for item in "$target"/* "$target"/.*; do
                [ -e "$item" ] || continue
                basename_item=$(basename "$item")
                [ "$basename_item" = "." ] && continue
                [ "$basename_item" = ".." ] && continue
                
                # 使用ls获取文件信息
                ls_output=$(ls -ld "$item" 2>/dev/null)
                
                # 手动解析ls输出
                set -- $ls_output
                perms="$1"
                links="$2"
                owner="$3"
                group="$4"
                size="$5"
                # 获取月份、日期、时间
                month="$6"
                day="$7"
                time="$8"
                
                if [ $human_readable -eq 1 ] && [ -n "$size" ]; then
                    if [ $size -ge 1048576 ]; then
                        size="$((size / 1048576))M"
                    elif [ $size -ge 1024 ]; then
                        size="$((size / 1024))K"
                    fi
                fi
                
                echo "$perms $links $owner $group $size $month $day $time $basename_item"
            done
        else
            # 显示单个文件
            ls_output=$(ls -ld "$target" 2>/dev/null)
            set -- $ls_output
            perms="$1"
            links="$2"
            owner="$3"
            group="$4"
            size="$5"
            month="$6"
            day="$7"
            time="$8"
            
            if [ $human_readable -eq 1 ]; then
                if [ $size -ge 1048576 ]; then
                    size="$((size / 1048576))M"
                elif [ $size -ge 1024 ]; then
                    size="$((size / 1024))K"
                fi
            fi
            
            echo "$perms $links $owner $group $size $month $day $time $(basename "$target")"
        fi
    else
        # 简单格式显示
        if [ -d "$target" ]; then
            first=1
            for item in "$target"/* "$target"/.*; do
                [ -e "$item" ] || continue
                basename_item=$(basename "$item")
                [ "$basename_item" = "." ] && continue
                [ "$basename_item" = ".." ] && continue
                
                if [ $first -eq 1 ]; then
                    printf "%s" "$basename_item"
                    first=0
                else
                    printf "  %s" "$basename_item"
                fi
            done
            echo ""
        else
            echo "$(basename "$target")"
        fi
    fi
}

# 处理cd命令
cmd_cd() {
    if [ $# -eq 0 ] || [ "$1" = "~" ]; then
        target="$(get_home_path)"
    elif [ "$1" = ".." ]; then
        # 检查是否已经是根目录
        if [ "$CURRENT_DIR" = "$FURNUX_ROOT" ]; then
            echo -e "${RED}已经是根目录！🐾${NC}"
            return 1
        fi
        target=$(dirname "$CURRENT_DIR")
    else
        target=$(get_real_path "$1")
    fi
    
    # 检查路径是否安全
    if ! is_path_safe "$target"; then
        echo -e "${RED}无法访问根目录之外的路径！🐾${NC}"
        return 1
    fi
    
    # 检查目标是否存在且是目录
    if [ ! -d "$target" ]; then
        echo -e "${RED}目录不存在！🐾${NC}"
        return 1
    fi
    
    # 检查读取权限
    if [ ! -r "$target" ]; then
        echo -e "${RED}权限不足！🐾${NC}"
        return 1
    fi
    
    CURRENT_DIR="$target"
}

# 处理pwd命令
cmd_pwd() {
    rel_path=$(get_relative_path "$CURRENT_DIR")
    echo "$rel_path"
}

# 处理mkdir命令
cmd_mkdir() {
    recursive=0
    target=""
    all_args="$*"
    
    for arg in $all_args; do
        case "$arg" in
            -p) recursive=1 ;;
            -*)
                echo -e "${RED}无效参数！🐾${NC}"
                return 1
                ;;
            *) target="$arg" ;;
        esac
    done
    
    if [ -z "$target" ]; then
        echo -e "${RED}缺少操作数！🐾${NC}"
        return 1
    fi
    
    target=$(get_real_path "$target")
    
    # 检查写权限
    if ! check_write_permission "$target"; then
        echo -e "${RED}权限不足，无法创建目录！🐾${NC}"
        return 1
    fi
    
    if [ $recursive -eq 1 ]; then
        mkdir -p "$target" 2>/dev/null
    else
        mkdir "$target" 2>/dev/null
    fi
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}创建目录失败！🐾${NC}"
        return 1
    fi
}

# 处理touch命令
cmd_touch() {
    if [ $# -eq 0 ]; then
        echo -e "${RED}缺少操作数！🐾${NC}"
        return 1
    fi
    
    target=$(get_real_path "$1")
    
    # 检查写权限
    if ! check_write_permission "$target"; then
        echo -e "${RED}权限不足！🐾${NC}"
        return 1
    fi
    
    touch "$target" 2>/dev/null
    if [ $? -ne 0 ]; then
        echo -e "${RED}创建文件失败！🐾${NC}"
        return 1
    fi
}

# 处理cat命令
cmd_cat() {
    if [ $# -eq 0 ]; then
        echo -e "${RED}缺少操作数！🐾${NC}"
        return 1
    fi
    
    target=$(get_real_path "$1")
    
    if [ ! -f "$target" ]; then
        echo -e "${RED}文件不存在！🐾${NC}"
        return 1
    fi
    
    if [ ! -r "$target" ]; then
        echo -e "${RED}权限不足！🐾${NC}"
        return 1
    fi
    
    cat "$target" 2>/dev/null
}

# 处理clear命令
cmd_clear() {
    printf "\033[2J\033[H"
}

# 处理df命令
cmd_df() {
    human=0
    show_type=0
    all_args="$*"
    
    for arg in $all_args; do
        case "$arg" in
            -h) human=1 ;;
            -T) show_type=1 ;;
        esac
    done
    
    echo "Filesystem      Size  Used Avail Use% Mounted on"
    # 使用df获取实际数据
    df_output=$(df -k "$FURNUX_ROOT" 2>/dev/null | tail -1)
    # 手动解析df输出
    set -- $df_output
    filesystem="$1"
    blocks="$2"
    used="$3"
    avail="$4"
    use_percent="$5"
    mounted="$6"
    
    # 移除百分号
    use_percent=$(echo "$use_percent" | sed 's/%//')
    
    if [ $human -eq 1 ]; then
        blocks="$((blocks / 1024))M"
        used="$((used / 1024))M"
        avail="$((avail / 1024))M"
    fi
    
    if [ $show_type -eq 1 ]; then
        echo "/dev/block/sda1 ext4 $blocks $used $avail $use_percent% /"
    else
        echo "/dev/block/sda1 $blocks $used $avail $use_percent% /"
    fi
}

# 处理du命令
cmd_du() {
    human=0
    summarize=0
    target="."
    all_args="$*"
    
    for arg in $all_args; do
        case "$arg" in
            -h) human=1 ;;
            -s) summarize=1 ;;
            -*)
                ;;
            *) target="$arg" ;;
        esac
    done
    
    target=$(get_real_path "$target")
    
    if [ ! -e "$target" ]; then
        echo -e "${RED}目标不存在！🐾${NC}"
        return 1
    fi
    
    if [ $summarize -eq 1 ]; then
        size=$(du -k "$target" 2>/dev/null | tail -1 | while read s p; do echo "$s"; break; done)
        if [ $human -eq 1 ]; then
            if [ $size -ge 1048576 ]; then
                size="$((size / 1048576))G"
            elif [ $size -ge 1024 ]; then
                size="$((size / 1024))M"
            else
                size="${size}K"
            fi
        fi
        echo "$size $(basename "$target")"
    else
        du -k "$target" 2>/dev/null | while read size path; do
            if [ $human -eq 1 ]; then
                if [ $size -ge 1048576 ]; then
                    size="$((size / 1048576))G"
                elif [ $size -ge 1024 ]; then
                    size="$((size / 1024))M"
                else
                    size="${size}K"
                fi
            fi
            rel_path=$(get_relative_path "$path")
            echo "$size $rel_path"
        done
    fi
}

# 处理free命令
cmd_free() {
    human=0
    mb=0
    all_args="$*"
    
    for arg in $all_args; do
        case "$arg" in
            -h) human=1 ;;
            -m) mb=1 ;;
        esac
    done
    
    echo "              total        used        free      shared  buff/cache"
    
    # 尝试获取内存信息
    if [ -f "/proc/meminfo" ]; then
        mem_total=$(grep MemTotal /proc/meminfo | grep -o '[0-9]*')
        mem_free=$(grep MemFree /proc/meminfo | grep -o '[0-9]*')
        mem_used=$((mem_total - mem_free))
    else
        mem_total="1000000"
        mem_used="500000"
        mem_free="500000"
    fi
    
    if [ $human -eq 1 ]; then
        mem_total="$((mem_total / 1024))M"
        mem_used="$((mem_used / 1024))M"
        mem_free="$((mem_free / 1024))M"
    elif [ $mb -eq 1 ]; then
        mem_total="$((mem_total / 1024))"
        mem_used="$((mem_used / 1024))"
        mem_free="$((mem_free / 1024))"
    fi
    
    echo "Mem:    $mem_total    $mem_used    $mem_free        0        0"
}

# 处理uname命令
cmd_uname() {
    if [ "$1" = "-a" ]; then
        echo "Linux $HOSTNAME 5.10.149-android #1 SMP PREEMPT $(date +%Y-%m-%d) aarch64 GNU/Linux"
    else
        echo "Linux"
    fi
}

# 处理whoami命令
cmd_whoami() {
    echo "$CURRENT_USER"
}

# 处理ping命令
cmd_ping() {
    count=4
    interval=1
    target=""
    all_args="$*"
    last_arg=""
    
    for arg in $all_args; do
        case "$arg" in
            -c) 
                count="" 
                last_arg="c"
                ;;
            -i) 
                interval=""
                last_arg="i"
                ;;
            *)
                if [ "$last_arg" = "c" ] && [ -z "$count" ]; then
                    count="$arg"
                    last_arg=""
                elif [ "$last_arg" = "i" ] && [ -z "$interval" ]; then
                    interval="$arg"
                    last_arg=""
                elif [ -z "$target" ]; then
                    target="$arg"
                fi
                ;;
        esac
    done
    
    if [ -z "$target" ]; then
        echo -e "${RED}缺少目标主机！🐾${NC}"
        return 1
    fi
    
    echo "PING $target ($target): 56 data bytes"
    
    i=1
    while [ $i -le $count ]; do
        echo "64 bytes from $target: icmp_seq=$i ttl=64 time=0.1 ms"
        sleep $interval
        i=$((i+1))
    done
}

# 处理ifconfig命令
cmd_ifconfig() {
    echo "lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536"
    echo "        inet 127.0.0.1  netmask 255.0.0.0"
    echo "        inet6 ::1  prefixlen 128  scopeid 0x10<host>"
    echo "        loop  txqueuelen 1000  (Local Loopback)"
    echo ""
    echo "wlan0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500"
    echo "        inet 192.168.1.100  netmask 255.255.255.0  broadcast 192.168.1.255"
    echo "        inet6 fe80::1234:5678:9abc:def0  prefixlen 64  scopeid 0x20<link>"
    echo "        ether 12:34:56:78:90:ab  txqueuelen 1000  (Ethernet)"
}

# 处理wget命令
cmd_wget() {
    output=""
    resume=0
    recursive=0
    url=""
    all_args="$*"
    last_arg=""
    
    for arg in $all_args; do
        case "$arg" in
            -O) 
                output="" 
                last_arg="O"
                ;;
            -c) resume=1 ;;
            -r) recursive=1 ;;
            -*)
                ;;
            *)
                if [ "$last_arg" = "O" ] && [ -z "$output" ]; then
                    output="$arg"
                    last_arg=""
                elif [ -z "$url" ]; then
                    url="$arg"
                fi
                ;;
        esac
    done
    
    if [ -z "$url" ]; then
        echo -e "${RED}缺少URL！🐾${NC}"
        return 1
    fi
    
    if [ -z "$output" ]; then
        output=$(basename "$url")
    fi
    
    # 检查写权限
    if ! check_write_permission "$output"; then
        echo -e "${RED}权限不足，无法写入文件！🐾${NC}"
        return 1
    fi
    
    echo "正在下载 $url..."
    echo "已保存到 $output"
}

# 处理curl命令
cmd_curl() {
    output=""
    head_only=0
    url=""
    all_args="$*"
    last_arg=""
    
    for arg in $all_args; do
        case "$arg" in
            -o) 
                output="" 
                last_arg="o"
                ;;
            -I) head_only=1 ;;
            -*)
                ;;
            *)
                if [ "$last_arg" = "o" ] && [ -z "$output" ]; then
                    output="$arg"
                    last_arg=""
                elif [ -z "$url" ]; then
                    url="$arg"
                fi
                ;;
        esac
    done
    
    if [ -z "$url" ]; then
        echo -e "${RED}缺少URL！🐾${NC}"
        return 1
    fi
    
    if [ $head_only -eq 1 ]; then
        echo "HTTP/1.1 200 OK"
        echo "Content-Type: text/html"
        echo "Content-Length: 1024"
    else
        if [ -n "$output" ]; then
            # 检查写权限
            if ! check_write_permission "$output"; then
                echo -e "${RED}权限不足，无法写入文件！🐾${NC}"
                return 1
            fi
            echo "数据已保存到 $output"
        else
            echo "<html><body>Furnux Terminal</body></html>"
        fi
    fi
}

# 处理cp命令
cmd_cp() {
    recursive=0
    src=""
    dest=""
    all_args="$*"
    
    for arg in $all_args; do
        case "$arg" in
            -r) recursive=1 ;;
            -*)
                echo -e "${RED}无效参数！🐾${NC}"
                return 1
                ;;
            *)
                if [ -z "$src" ]; then
                    src="$arg"
                elif [ -z "$dest" ]; then
                    dest="$arg"
                fi
                ;;
        esac
    done
    
    if [ -z "$src" ] || [ -z "$dest" ]; then
        echo -e "${RED}缺少操作数！🐾${NC}"
        return 1
    fi
    
    src=$(get_real_path "$src")
    dest=$(get_real_path "$dest")
    
    # 检查源是否存在
    if [ ! -e "$src" ]; then
        echo -e "${RED}源文件不存在！🐾${NC}"
        return 1
    fi
    
    # 检查写权限
    if ! check_write_permission "$dest"; then
        echo -e "${RED}权限不足，无法写入目标！🐾${NC}"
        return 1
    fi
    
    if [ -d "$src" ] && [ $recursive -eq 0 ]; then
        echo -e "${RED}省略目录，请使用 -r 选项！🐾${NC}"
        return 1
    fi
    
    if [ -d "$src" ]; then
        cp -r "$src" "$dest" 2>/dev/null
    else
        cp "$src" "$dest" 2>/dev/null
    fi
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}复制失败！🐾${NC}"
        return 1
    fi
}

# 处理mv命令
cmd_mv() {
    if [ $# -lt 2 ]; then
        echo -e "${RED}缺少操作数！🐾${NC}"
        return 1
    fi
    
    src=$(get_real_path "$1")
    dest=$(get_real_path "$2")
    
    # 检查源是否存在
    if [ ! -e "$src" ]; then
        echo -e "${RED}源文件不存在！🐾${NC}"
        return 1
    fi
    
    # 检查写权限
    if ! check_write_permission "$src" || ! check_write_permission "$dest"; then
        echo -e "${RED}权限不足！🐾${NC}"
        return 1
    fi
    
    mv "$src" "$dest" 2>/dev/null
    if [ $? -ne 0 ]; then
        echo -e "${RED}移动失败！🐾${NC}"
        return 1
    fi
}

# 处理rm命令
cmd_rm() {
    recursive=0
    force=0
    target=""
    all_args="$*"
    
    for arg in $all_args; do
        case "$arg" in
            -r) recursive=1 ;;
            -f) force=1 ;;
            -*)
                echo -e "${RED}无效参数！🐾${NC}"
                return 1
                ;;
            *) target="$arg" ;;
        esac
    done
    
    if [ -z "$target" ]; then
        echo -e "${RED}缺少操作数！🐾${NC}"
        return 1
    fi
    
    target=$(get_real_path "$target")
    
    # 检查目标是否存在
    if [ ! -e "$target" ]; then
        if [ $force -eq 1 ]; then
            return 0
        else
            echo -e "${RED}目标不存在！🐾${NC}"
            return 1
        fi
    fi
    
    # 检查写权限
    if ! check_write_permission "$target"; then
        echo -e "${RED}权限不足！🐾${NC}"
        return 1
    fi
    
    if [ -d "$target" ] && [ $recursive -eq 0 ]; then
        echo -e "${RED}无法删除目录，请使用 -r 选项！🐾${NC}"
        return 1
    fi
    
    if [ $force -eq 1 ]; then
        rm -rf "$target" 2>/dev/null
    else
        if [ -d "$target" ]; then
            rm -r "$target" 2>/dev/null
        else
            rm "$target" 2>/dev/null
        fi
    fi
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}删除失败！🐾${NC}"
        return 1
    fi
}

# 处理help命令
cmd_help() {
    echo "Furnux 终端命令列表："
    echo "----------------------"
    echo "文件操作命令："
    echo "  ls [-l] [-h] [路径]         - 列出目录内容"
    echo "  cd [路径]                    - 切换目录"
    echo "  pwd                          - 显示当前路径"
    echo "  cp [-r] 源 目标               - 复制文件/目录"
    echo "  mv 源 目标                    - 移动/重命名"
    echo "  rm [-r] [-f] 文件/目录        - 删除"
    echo "  mkdir [-p] 目录名             - 创建目录"
    echo "  touch 文件名                  - 创建文件"
    echo "  cat 文件                      - 显示文件内容"
    echo ""
    echo "系统信息命令："
    echo "  df [-h] [-T]                 - 查看磁盘使用"
    echo "  du [-h] [-s] [路径]          - 查看目录大小"
    echo "  free [-h] [-m]               - 查看内存使用"
    echo "  uname [-a]                    - 显示系统信息"
    echo "  whoami                        - 显示当前用户"
    echo ""
    echo "网络命令："
    echo "  ping [-c 次数] [-i 间隔] 主机  - 测试网络"
    echo "  ifconfig                       - 查看网络接口"
    echo "  wget [-O 文件名] [-c] [-r] URL - 下载文件"
    echo "  curl [-o 文件] [-I] URL        - 传输数据"
    echo ""
    echo "其他命令："
    echo "  clear                         - 清屏"
    echo "  furry                         - 切换为furry用户"
    echo "  user                          - 切换为普通用户"
    echo "  furdo 命令                     - 以furry身份执行命令"
    echo "  help                          - 显示本帮助"
    echo "  info                          - 显示脚本信息"
    echo "  exit                          - 退出脚本"
}

# 处理info命令
cmd_info() {
    echo "🐾Furnux Terminal🐾"
    echo "🐾版本号：2026-03-17 22:31 1🐾"
    echo "🐾作者：Furry🐾"
    echo "🐾未经允许不得搬运🐾"
}

# 处理furry命令
cmd_furry() {
    if [ "$CURRENT_USER" = "furry" ]; then
        echo -e "${YELLOW}已经是furry用户！🐾${NC}"
        return 0
    fi
    
    printf "Password: "
    read -s password
    echo ""
    
    if [ "$password" = "$FURRY_PASSWORD" ]; then
        CURRENT_USER="furry"
        echo -e "${GREEN}切换到furry用户！🐾${NC}"
    else
        echo -e "${RED}密码错误！🐾${NC}"
    fi
}

# 处理user命令
cmd_user() {
    if [ "$CURRENT_USER" = "user" ]; then
        echo -e "${YELLOW}已经是普通用户！🐾${NC}"
        return 0
    fi
    
    CURRENT_USER="user"
    echo -e "${GREEN}切换到普通用户！🐾${NC}"
}

# 处理furdo命令
cmd_furdo() {
    if [ "$CURRENT_USER" != "user" ]; then
        echo -e "${RED}furdo命令仅限普通用户使用！🐾${NC}"
        return 1
    fi
    
    if [ $# -eq 0 ]; then
        echo -e "${RED}请输入要执行的命令！🐾${NC}"
        return 1
    fi
    
    printf "Password: "
    read -s password
    echo ""
    
    if [ "$password" != "$FURDO_PASSWORD" ]; then
        echo -e "${RED}密码错误！🐾${NC}"
        return 1
    fi
    
    # 临时切换为furry用户执行命令
    old_user="$CURRENT_USER"
    CURRENT_USER="furry"
    
    # 执行命令
    cmd="$1"
    shift
    execute_command "$cmd" "$@"
    result=$?
    
    # 切回原用户
    CURRENT_USER="$old_user"
    return $result
}

# 处理exit命令
cmd_exit() {
    exit 0
}

# 执行命令的主函数
execute_command() {
    cmd="$1"
    shift
    
    if ! is_command_allowed "$cmd"; then
        echo -e "${RED}无效命令或参数！🐾${NC}"
        return 1
    fi
    
    case "$cmd" in
        ls) cmd_ls "$@" ;;
        cd) cmd_cd "$@" ;;
        pwd) cmd_pwd ;;
        cp) cmd_cp "$@" ;;
        mv) cmd_mv "$@" ;;
        rm) cmd_rm "$@" ;;
        mkdir) cmd_mkdir "$@" ;;
        touch) cmd_touch "$@" ;;
        cat) cmd_cat "$@" ;;
        clear) cmd_clear ;;
        df) cmd_df "$@" ;;
        du) cmd_du "$@" ;;
        free) cmd_free "$@" ;;
        uname) cmd_uname "$@" ;;
        whoami) cmd_whoami ;;
        ping) cmd_ping "$@" ;;
        ifconfig) cmd_ifconfig ;;
        wget) cmd_wget "$@" ;;
        curl) cmd_curl "$@" ;;
        help) cmd_help ;;
        furry) cmd_furry ;;
        user) cmd_user ;;
        furdo) cmd_furdo "$@" ;;
        info) cmd_info ;;
        exit) cmd_exit ;;
        *) 
            echo -e "${RED}无效命令或参数！🐾${NC}"
            return 1
            ;;
    esac
}

# 显示提示符
show_prompt() {
    rel_path=$(get_relative_path "$CURRENT_DIR")
    
    if [ "$CURRENT_USER" = "furry" ]; then
        echo -ne "${RED}[furry🦊$HOSTNAME🐾($rel_path)]# ${NC}"
    else
        echo -ne "${GREEN}[user🦊$HOSTNAME🐾($rel_path)]\$ ${NC}"
    fi
}

# 解析命令和参数
parse_command() {
    input="$1"
    
    # 提取第一个单词作为命令
    cmd=""
    for word in $input; do
        cmd="$word"
        break
    done
    
    # 提取剩余部分作为参数
    args=""
    if [ -n "$cmd" ]; then
        args=$(echo "$input" | cut -d' ' -f2-)
    fi
    
    echo "$cmd|$args"
}

# 初始化
init_filesystem

# 显示欢迎信息
echo -e "${WHITE}🐾Welcome to Furnux!🐾${NC}"
sleep 0.6
echo -e "${WHITE}🦊脚本命令与linux命令略有差异🐾${NC}"
sleep 0.6
echo -e "${WHITE}🦊首次使用请运行help查看命令列表🐾${NC}"
sleep 1

# 主循环
while true; do
    show_prompt
    read input
    
    # 跳过空输入
    if [ -z "$input" ]; then
        continue
    fi
    
    # 解析命令和参数
    parsed=$(parse_command "$input")
    cmd=$(echo "$parsed" | cut -d'|' -f1)
    args=$(echo "$parsed" | cut -d'|' -f2)
    
    execute_command "$cmd" $args
done