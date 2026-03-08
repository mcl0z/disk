<?php
declare(strict_types=1);

// ==================================================
// 资本家社区 v10.1 - 终极修复版 (2025-03-09)
// 修复：所有已知错误、聊天室管理、位置共享、
//       手机UI自适应、密码修改、角色设置、数据持久化
// ==================================================

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', 1);
ini_set('error_log', dirname(__FILE__) . '/error.log');
session_start();
ob_start();

// ==================== 常量定义 ====================
const DATA_FILE = 'data.txt';
const USERS_FILE = 'users.txt';
const CHAT_FILE = 'chats.txt';
const MESSAGES_FILE = 'messages.txt';
const FRIENDS_FILE = 'friends.txt';
const BLOCKS_FILE = 'blocks.txt';
const TOKENS_FILE = 'tokens.txt';
const ONLINE_FILE = 'online.txt';
const POSTS_FILE = 'posts.txt';
const COMMENTS_FILE = 'comments.txt';
const CATEGORIES_FILE = 'categories.txt';
const ADS_FILE = 'ads.txt';
const REPORTS_FILE = 'reports.txt';
const APPEALS_FILE = 'appeals.txt';
const TASKS_FILE = 'tasks.txt';
const CUSTOM_TITLES_FILE = 'custom_titles.txt';
const LOGS_FILE = 'logs.txt';
const NEWS_FILE = 'news.txt';
const DANMAKU_FILE = 'danmaku.txt';
const DONATE_FILE = 'donate.txt';
const PAID_POST_FILE = 'paid_posts.txt';

const DANMAKU_MAX = 200;
const DANMAKU_SPEED = 8000;
const UPLOAD_DIR = 'uploads/';
const MAX_MESSAGES = 500;
const ONLINE_TIMEOUT = 60;
const RECALL_TIMEOUT = 300;
const POSTS_PER_PAGE = 20;
const REPUTATION_TRUST = 100;
const VOTE_BAN_THRESHOLD = 5;
const TITLE_PRICE = 200;
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

// ==================== 枚举定义 ====================
enum UserRole: string {
    case ADMIN = 'admin';
    case REVIEWER = 'reviewer';
    case USER = 'user';
    case BANNED = 'banned';
    
    public function label(): string {
        return match($this) {
            self::ADMIN => '超级管理员',
            self::REVIEWER => '审核员',
            self::USER => '普通用户',
            self::BANNED => '已封禁'
        };
    }
}

enum PostStatus: string {
    case DRAFT = 'draft';
    case PENDING = 'pending';
    case APPROVED = 'approved';
    case REJECTED = 'rejected';
    
    public function color(): string {
        return match($this) {
            self::DRAFT => '#9ca3af',
            self::PENDING => '#f59e0b',
            self::APPROVED => '#10b981',
            self::REJECTED => '#ef4444'
        };
    }
}

enum VoteResult: string {
    case BAN = 'ban';
    case NO_BAN = 'noban';
    case PENDING = 'pending';
}

enum AppealStatus: string {
    case PENDING = 'pending';
    case ACCEPTED = 'accepted';
    case REJECTED = 'rejected';
}

enum AdStatus: string {
    case ACTIVE = 'active';
    case PENDING = 'pending';
    case REJECTED = 'rejected';
    case EXPIRED = 'expired';
}

enum MessageType: string {
    case CHAT = 'chat';
    case PRIVATE = 'private';
    case SYSTEM = 'system';
}

enum DanmakuPosition: int {
    case SCROLL = 0;
    case TOP = 1;
    case BOTTOM = 2;
}

// ==================== 数据缓存（带文件修改时间检查） ====================
$GLOBALS['_data_cache'] = [];
$GLOBALS['_file_mtime'] = [];

function loadData(string $file, bool $forceRefresh = false): array {
    // 检查文件是否存在
    if (!file_exists($file)) {
        return [];
    }
    
    $currentMtime = filemtime($file);
    
    // 如果强制刷新或缓存不存在或文件已修改，则重新读取
    if ($forceRefresh || !isset($GLOBALS['_data_cache'][$file]) || $GLOBALS['_file_mtime'][$file] !== $currentMtime) {
        $fp = @fopen($file, 'r');
        if ($fp === false) {
            return [];
        }
        
        // 加共享锁，最多等待3秒
        $locked = false;
        $start = time();
        while (!$locked) {
            if (flock($fp, LOCK_SH)) {
                $locked = true;
            } elseif (time() - $start > 3) {
                fclose($fp);
                return [];
            } else {
                usleep(100000);
            }
        }
        
        $content = '';
        while (!feof($fp)) {
            $content .= fread($fp, 8192);
        }
        
        flock($fp, LOCK_UN);
        fclose($fp);
        
        $data = @unserialize($content);
        $data = is_array($data) ? $data : [];
        
        $GLOBALS['_data_cache'][$file] = $data;
        $GLOBALS['_file_mtime'][$file] = $currentMtime;
    }
    
    return $GLOBALS['_data_cache'][$file];
}

function saveData(string $file, array $data, int $maxRetries = 5): bool {
    $fp = @fopen($file, 'w');
    if ($fp === false) {
        error_log("saveData: failed to open $file");
        return false;
    }
    
    $locked = false;
    $retries = 0;
    while (!$locked && $retries < $maxRetries) {
        if (flock($fp, LOCK_EX)) {
            $locked = true;
        } else {
            $retries++;
            usleep(100000);
        }
    }
    
    if (!$locked) {
        fclose($fp);
        error_log("saveData: flock timeout for $file after $maxRetries retries");
        return false;
    }
    
    ftruncate($fp, 0);
    fwrite($fp, serialize($data));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    
    // 更新缓存
    $GLOBALS['_data_cache'][$file] = $data;
    $GLOBALS['_file_mtime'][$file] = time(); // 使用当前时间作为修改时间（近似）
    
    usleep(50000);
    return true;
}

function hashPassword(string $pwd): string {
    // 直接使用 password_hash，不加固定后缀
    return password_hash($pwd, PASSWORD_DEFAULT);
}

function verifyPassword(string $pwd, string $hash): bool {
    return password_verify($pwd, $hash);
}

function generateToken(string $user): string {
    $tokens = loadData(TOKENS_FILE);
    $tokens = is_array($tokens) ? $tokens : [];
    
    $token = bin2hex(random_bytes(32));
    $tokens[$user] = [
        'token' => $token,
        'expire' => time() + 86400
    ];
    
    saveData(TOKENS_FILE, $tokens);
    return $token;
}

function verifyToken(string $user, string $token): bool {
    if ($user === '' || $token === '') {
        error_log("verifyToken: empty user or token");
        return false;
    }
    
    $tokens = loadData(TOKENS_FILE);
    if (!is_array($tokens) || !isset($tokens[$user])) {
        error_log("verifyToken: no tokens for user $user");
        return false;
    }
    
    $t = $tokens[$user];
    if (!is_array($t) || !isset($t['token'], $t['expire'])) {
        error_log("verifyToken: invalid token data for user $user");
        return false;
    }
    
    if ($t['token'] !== $token) {
        error_log("verifyToken: token mismatch for user $user");
        return false;
    }
    
    if ($t['expire'] < time()) {
        error_log("verifyToken: token expired for user $user");
        unset($tokens[$user]);
        saveData(TOKENS_FILE, $tokens);
        return false;
    }
    
    return true;
}

function updateOnline(string $user): void {
    $online = loadData(ONLINE_FILE);
    $online = is_array($online) ? $online : [];
    
    if (count($online) > 50 && !isset($online[$user])) {
        $keys = array_keys($online);
        if (!empty($keys)) {
            unset($online[$keys[0]]);
        }
    }
    
    $online[$user] = time();
    $expire = time() - ONLINE_TIMEOUT;
    
    foreach ($online as $u => $t) {
        if ($t < $expire) {
            unset($online[$u]);
        }
    }
    
    saveData(ONLINE_FILE, $online);
}

function isOnline(string $user): bool {
    $online = loadData(ONLINE_FILE);
    return isset($online[$user]) && (time() - $online[$user] < ONLINE_TIMEOUT);
}

function isBlocked(string $user, string $target): bool {
    $blocks = loadData(BLOCKS_FILE);
    return isset($blocks[$user][$target]);
}

function blockUser(string $user, string $target): bool {
    if ($user === $target) {
        return false;
    }
    
    $blocks = loadData(BLOCKS_FILE);
    $blocks = is_array($blocks) ? $blocks : [];
    if (!isset($blocks[$user])) {
        $blocks[$user] = [];
    }
    
    $blocks[$user][$target] = time();
    return saveData(BLOCKS_FILE, $blocks);
}

function unblockUser(string $user, string $target): bool {
    $blocks = loadData(BLOCKS_FILE);
    if (isset($blocks[$user][$target])) {
        unset($blocks[$user][$target]);
        return saveData(BLOCKS_FILE, $blocks);
    }
    return false;
}

function addFriend(string $user, string $friend): bool {
    $users = loadUsers();
    
    if (!isset($users[$user]) || !isset($users[$friend]) || $user === $friend || isBlocked($user, $friend)) {
        return false;
    }
    
    $friends = loadData(FRIENDS_FILE);
    $friends = is_array($friends) ? $friends : [];
    if (!isset($friends[$user])) {
        $friends[$user] = [];
    }
    
    if (!in_array($friend, $friends[$user], true)) {
        $friends[$user][] = $friend;
        return saveData(FRIENDS_FILE, $friends);
    }
    
    return true;
}

function removeFriend(string $user, string $friend): bool {
    $friends = loadData(FRIENDS_FILE);
    if (!is_array($friends) || !isset($friends[$user])) {
        return false;
    }
    
    $key = array_search($friend, $friends[$user], true);
    if ($key !== false) {
        unset($friends[$user][$key]);
        $friends[$user] = array_values($friends[$user]);
        return saveData(FRIENDS_FILE, $friends);
    }
    return false;
}

function getPrivateRoomId(string $u1, string $u2): string {
    $arr = [$u1, $u2];
    sort($arr);
    return 'p_' . md5($arr[0] . '_' . $arr[1]);
}

function loadMessages(string $room, int $since = 0): array {
    $all = loadData(MESSAGES_FILE);
    if (!is_array($all)) {
        return [];
    }
    
    if ($since === 0) {
        return $all[$room] ?? [];
    }
    
    $new = [];
    if (isset($all[$room]) && is_array($all[$room])) {
        foreach ($all[$room] as $msg) {
            if (is_array($msg) && isset($msg['t']) && $msg['t'] > $since) {
                $new[] = $msg;
            }
        }
    }
    
    return $new;
}

function saveMessage(string $room, string $user, string $nick, string $msg, string $to = ''): array {
    $all = loadData(MESSAGES_FILE, true); // 强制刷新缓存，避免并发问题
    $all = is_array($all) ? $all : [];
    if (!isset($all[$room])) {
        $all[$room] = [];
    }
    
    $mid = uniqid(mt_rand(), true); // 增加随机性
    $newMsg = [
        'id' => $mid,
        'u' => $user,
        'v' => $to,
        'n' => $nick,
        'm' => $msg,
        't' => time(),
        'ts' => date('H:i:s'),
        'edited' => 0,
        'history' => [],
        'read' => []
    ];
    
    $all[$room][$mid] = $newMsg;
    
    if (count($all[$room]) > MAX_MESSAGES) {
        uasort($all[$room], fn($a, $b) => ($a['t'] ?? 0) <=> ($b['t'] ?? 0));
        $keys = array_keys($all[$room]);
        $remove = count($all[$room]) - MAX_MESSAGES;
        for ($i = 0; $i < $remove; $i++) {
            unset($all[$room][$keys[$i]]);
        }
    }
    
    saveData(MESSAGES_FILE, $all);
    
    return $newMsg;
}

function markMessageRead(string $room, string $msgId, string $user): bool {
    $all = loadData(MESSAGES_FILE, true);
    if (!isset($all[$room][$msgId])) {
        return false;
    }
    
    if (!isset($all[$room][$msgId]['read'])) {
        $all[$room][$msgId]['read'] = [];
    }
    
    if (!in_array($user, $all[$room][$msgId]['read'], true)) {
        $all[$room][$msgId]['read'][] = $user;
        saveData(MESSAGES_FILE, $all);
    }
    
    return true;
}

function recallMessage(string $room, string $msgId, string $user, bool $isAdmin = false): bool {
    $all = loadData(MESSAGES_FILE, true);
    if (!isset($all[$room][$msgId])) {
        return false;
    }
    
    if (!$isAdmin && $all[$room][$msgId]['u'] !== $user) {
        return false;
    }
    
    if (!$isAdmin && (time() - $all[$room][$msgId]['t'] > RECALL_TIMEOUT)) {
        return false;
    }
    
    $all[$room][$msgId]['m'] = '🚫 消息已撤回';
    $all[$room][$msgId]['recalled'] = time();
    $all[$room][$msgId]['edited'] = 1;
    
    return saveData(MESSAGES_FILE, $all);
}

function editMessage(string $room, string $msgId, string $user, string $newMsg, bool $isAdmin = false): bool {
    $all = loadData(MESSAGES_FILE, true);
    if (!isset($all[$room][$msgId])) {
        return false;
    }
    
    if (!$isAdmin && $all[$room][$msgId]['u'] !== $user) {
        return false;
    }
    
    if (!isset($all[$room][$msgId]['history'])) {
        $all[$room][$msgId]['history'] = [];
    }
    
    $all[$room][$msgId]['history'][] = [
        'm' => $all[$room][$msgId]['m'],
        't' => time()
    ];
    
    $all[$room][$msgId]['m'] = $newMsg;
    $all[$room][$msgId]['edited'] = time();
    
    return saveData(MESSAGES_FILE, $all);
}

function getMessageHistory(string $room, string $msgId): array {
    $all = loadData(MESSAGES_FILE);
    return $all[$room][$msgId]['history'] ?? [];
}

function canManage(string $user, array $room): bool {
    if (isAdmin() || isReviewer()) {
        return true;
    }
    return ($room['owner'] ?? '') === $user || in_array($user, $room['admins'] ?? [], true);
}

function canSend(string $user, array &$room): bool {
    // 管理员/审核员自动加入（但不保存到文件，仅用于本次检查）
    if (!isset($room['members'][$user]) && (isAdmin() || isReviewer())) {
        // 注意：这里不修改 $room 的引用，因为调用方会负责保存
        // 实际发送消息时会自动加入并保存
    }
    
    if (!isset($room['members'][$user])) {
        return false;
    }
    
    if (!empty($room['settings']['all_muted'])) {
        return canManage($user, $room);
    }
    
    return empty($room['members'][$user]['muted']);
}

function autoJoinOfficial(string $user): void {
    $chats = loadData(CHAT_FILE);
    $chats = is_array($chats) ? $chats : [];
    
    if (isset($chats['official']) && !isset($chats['official']['members'][$user])) {
        $chats['official']['members'][$user] = [
            'role' => 'member',
            'muted' => 0,
            'joined' => time()
        ];
        saveData(CHAT_FILE, $chats);
    }
}

function syncAdminsToAllChats(): void {
    $chats = loadData(CHAT_FILE);
    if (!is_array($chats)) return;
    
    $users = loadUsers();
    $adminsAndReviewers = [];
    foreach ($users as $name => $user) {
        if (($user['role'] ?? '') === 'admin' || ($user['role'] ?? '') === 'reviewer') {
            $adminsAndReviewers[] = $name;
        }
    }
    if (empty($adminsAndReviewers)) return;
    
    $changed = false;
    foreach ($chats as $rid => &$room) {
        foreach ($adminsAndReviewers as $admin) {
            if (!isset($room['members'][$admin])) {
                $room['members'][$admin] = ['role' => 'member', 'muted' => 0, 'joined' => time()];
                $changed = true;
            }
            if (!in_array($admin, $room['admins'] ?? [])) {
                $room['admins'][] = $admin;
                $changed = true;
            }
        }
        if (!empty($room['admins'])) {
            $room['admins'] = array_unique($room['admins']);
        }
    }
    if ($changed) {
        saveData(CHAT_FILE, $chats);
    }
}

// ==================== 用户系统 ====================

function loadUsers(): array {
    $users = loadData(USERS_FILE);
    if (!is_array($users)) {
        return [];
    }
    foreach ($users as &$u) {
        if (isset($u['exp'])) $u['exp'] = (int)$u['exp'];
        if (isset($u['coin'])) $u['coin'] = (int)$u['coin'];
        if (isset($u['reputation'])) $u['reputation'] = (int)$u['reputation'];
        if (isset($u['level'])) $u['level'] = (int)$u['level'];
        if (isset($u['votes_today'])) $u['votes_today'] = (int)$u['votes_today'];
        if (isset($u['sign_count'])) $u['sign_count'] = (int)$u['sign_count'];
        if (isset($u['trusted'])) $u['trusted'] = (int)$u['trusted'];
        if (isset($u['latitude'])) $u['latitude'] = (float)$u['latitude'];
        if (isset($u['longitude'])) $u['longitude'] = (float)$u['longitude'];
        if (isset($u['location_sharing'])) $u['location_sharing'] = (int)$u['location_sharing'];
    }
    unset($u);
    return $users;
}

function saveUsers(array $users): bool {
    foreach ($users as &$u) {
        if (isset($u['exp'])) $u['exp'] = (int)$u['exp'];
        if (isset($u['coin'])) $u['coin'] = (int)$u['coin'];
        if (isset($u['reputation'])) $u['reputation'] = (int)$u['reputation'];
        if (isset($u['level'])) $u['level'] = (int)$u['level'];
        if (isset($u['votes_today'])) $u['votes_today'] = (int)$u['votes_today'];
        if (isset($u['sign_count'])) $u['sign_count'] = (int)$u['sign_count'];
        if (isset($u['trusted'])) $u['trusted'] = (int)$u['trusted'];
        if (isset($u['latitude'])) $u['latitude'] = (float)$u['latitude'];
        if (isset($u['longitude'])) $u['longitude'] = (float)$u['longitude'];
        if (isset($u['location_sharing'])) $u['location_sharing'] = (int)$u['location_sharing'];
    }
    unset($u);
    return saveData(USERS_FILE, $users);
}

function getLevel(int $exp): int {
    return match(true) {
        $exp < 100 => 1,
        $exp < 300 => 2,
        $exp < 600 => 3,
        $exp < 1000 => 4,
        $exp < 1500 => 5,
        $exp < 2100 => 6,
        $exp < 2800 => 7,
        $exp < 3600 => 8,
        $exp < 4500 => 9,
        default => 10 + (int)(($exp - 4500) / 2000)
    };
}

function getTitle(int $level): string {
    $titles = [
        '被封号',
        '新韭菜',
        '小韭菜',
        '青韭菜',
        '壮韭菜',
        '老韭菜',
        '韭菜头子',
        '韭菜王',
        '韭菜大亨',
        '韭菜资本家',
        '韭菜之神'
    ];
    return $titles[$level] ?? '韭菜之神';
}

function getReputationTitle(int $rep): string {
    return match(true) {
        $rep < 0 => '💔 信用破产',
        $rep < 30 => '⚠️ 信用危机',
        $rep < 60 => '🌱 初出茅庐',
        $rep < 80 => '🌿 小有名气',
        $rep < 100 => '🌟 信誉良好',
        default => '💎 信誉楷模'
    };
}

function isTrusted(array $user): bool {
    return ($user['trusted'] ?? false) || ((int)($user['reputation'] ?? 0) >= REPUTATION_TRUST);
}

function isBanned(array $user): bool {
    if (!isset($user['banned'])) {
        return false;
    }
    if ($user['banned'] === 'permanent') {
        return true;
    }
    // 兼容字符串数字的情况
    $banTime = is_numeric($user['banned']) ? (int)$user['banned'] : 0;
    return $banTime > time();
}

function doSign(string $username, array &$users, int $initialCoin): string {
    if (!isset($users[$username])) {
        return '用户不存在';
    }
    if (isBanned($users[$username])) {
        return '账号已被封禁';
    }
    $today = date('Y-m-d');
    if (($users[$username]['last_sign'] ?? '') === $today) {
        return '今天已经签过到啦';
    }
    $yesterday = date('Y-m-d', strtotime('-1 day'));
    if (($users[$username]['last_sign'] ?? '') === $yesterday) {
        $users[$username]['sign_count'] = ($users[$username]['sign_count'] ?? 0) + 1;
    } else {
        $users[$username]['sign_count'] = 1;
    }
    $bonus = min($users[$username]['sign_count'] * 2, 20);
    $users[$username]['exp'] = ($users[$username]['exp'] ?? 0) + 20 + $bonus;
    $users[$username]['coin'] = ($users[$username]['coin'] ?? $initialCoin) + 20 + $bonus;
    $users[$username]['reputation'] = ($users[$username]['reputation'] ?? 50) + 5 + (int)($bonus / 2); // 信誉分适当减少增长
    $users[$username]['last_sign'] = $today;
    $users[$username]['level'] = getLevel((int)$users[$username]['exp']);
    return sprintf(
        "签到成功！获得经验 %d，资本币 %d，信誉分 %d，连续签到 %d 天",
        20 + $bonus,
        20 + $bonus,
        5 + (int)($bonus / 2),
        $users[$username]['sign_count']
    );
}

function banUser(string $username, int $hours = 24, bool $permanent = false): bool {
    $users = loadUsers();
    if (!isset($users[$username]) || $username === 'admin') {
        return false;
    }
    $users[$username]['banned'] = $permanent ? 'permanent' : (time() + $hours * 3600);
    $success = saveUsers($users);
    if ($success) {
        addLog("管理员封禁用户: $username" . ($permanent ? '永久' : " $hours 小时"));
    }
    return $success;
}

function unbanUser(string $username): bool {
    $users = loadUsers();
    if (!isset($users[$username])) {
        return false;
    }
    unset($users[$username]['banned']);
    $success = saveUsers($users);
    if ($success) {
        addLog("管理员解封用户: $username");
    }
    return $success;
}

function deleteUser(string $username): bool {
    $users = loadUsers();
    if ($username === ($_SESSION['user'] ?? '')) {
        addLog("管理员尝试删除自己，已阻止");
        return false;
    }
    if (!isset($users[$username]) || $username === 'admin') {
        return false;
    }
    
    // 删除相关数据（帖子、评论、私聊、好友、黑名单、自定义称号等）
    // 帖子
    $posts = loadData(POSTS_FILE);
    if (is_array($posts)) {
        $posts = array_filter($posts, fn($p) => ($p['author'] ?? '') !== $username);
        saveData(POSTS_FILE, array_values($posts));
    }
    // 评论
    $comments = loadData(COMMENTS_FILE);
    if (is_array($comments)) {
        $comments = array_filter($comments, fn($c) => ($c['author'] ?? '') !== $username);
        saveData(COMMENTS_FILE, array_values($comments));
    }
    // 好友关系
    $friends = loadData(FRIENDS_FILE);
    if (is_array($friends)) {
        unset($friends[$username]);
        foreach ($friends as &$list) {
            $list = array_values(array_filter($list, fn($f) => $f !== $username));
        }
        saveData(FRIENDS_FILE, $friends);
    }
    // 黑名单
    $blocks = loadData(BLOCKS_FILE);
    if (is_array($blocks)) {
        unset($blocks[$username]);
        foreach ($blocks as &$list) {
            unset($list[$username]);
        }
        saveData(BLOCKS_FILE, $blocks);
    }
    // 自定义称号
    $titles = loadCustomTitles();
    unset($titles[$username]);
    saveCustomTitles($titles);
    // 私聊消息（保留，但显示用户已删除）
    // 可以不删除，留作记录
    
    unset($users[$username]);
    $success = saveUsers($users);
    if ($success) {
        addLog("管理员删除用户: $username");
    }
    return $success;
}

function addAppeal(string $username, string $reason): bool {
    $appeals = loadData(APPEALS_FILE);
    $appeals = is_array($appeals) ? $appeals : [];
    $appeals[] = [
        'id' => uniqid('', true),
        'user' => $username,
        'reason' => $reason,
        'time' => time(),
        'status' => AppealStatus::PENDING->value
    ];
    return saveData(APPEALS_FILE, $appeals);
}

function getAppeals(?AppealStatus $status = null): array {
    $appeals = loadData(APPEALS_FILE);
    if (!is_array($appeals)) {
        return [];
    }
    if ($status === null) {
        return $appeals;
    }
    return array_values(array_filter($appeals, fn($a) => ($a['status'] ?? '') === $status->value));
}

function handleAppeal(string $id, AppealStatus $action): bool {
    $appeals = loadData(APPEALS_FILE);
    if (!is_array($appeals)) {
        return false;
    }
    foreach ($appeals as $k => $a) {
        if (($a['id'] ?? '') === $id) {
            if ($action === AppealStatus::ACCEPTED) {
                unbanUser($a['user'] ?? '');
                $appeals[$k]['status'] = AppealStatus::ACCEPTED->value;
                addLog("管理员接受申诉: " . ($a['user'] ?? ''));
            } elseif ($action === AppealStatus::REJECTED) {
                $appeals[$k]['status'] = AppealStatus::REJECTED->value;
                addLog("管理员拒绝申诉: " . ($a['user'] ?? ''));
            }
            return saveData(APPEALS_FILE, $appeals);
        }
    }
    return false;
}

function uploadAvatarSimple(array $file, string $username): string|false {
    if ($file['error'] !== UPLOAD_ERR_OK) {
        error_log("uploadAvatarSimple: upload error " . $file['error']);
        return false;
    }
    if ($file['size'] > MAX_FILE_SIZE) {
        error_log("uploadAvatarSimple: file too large");
        return false;
    }
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = finfo_file($finfo, $file['tmp_name']);
    finfo_close($finfo);
    $allowedMimes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!in_array($mime, $allowedMimes, true)) {
        error_log("uploadAvatarSimple: invalid mime type $mime");
        return false;
    }
    $ext = match($mime) {
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/gif'  => 'gif',
        default      => ''
    };
    if ($ext === '') {
        return false;
    }
    // 清理用户名，防止路径穿越
    $safeUser = preg_replace('/[^a-zA-Z0-9_]/', '', $username);
    $filename = $safeUser . '_' . uniqid('', true) . '.' . $ext;
    $path = UPLOAD_DIR . 'avatars/' . $filename;
    if (!is_dir(UPLOAD_DIR . 'avatars/')) {
        mkdir(UPLOAD_DIR . 'avatars/', 0777, true);
    }
    if (move_uploaded_file($file['tmp_name'], $path)) {
        return $filename;
    }
    error_log("uploadAvatarSimple: move_uploaded_file failed");
    return false;
}

// ==================== 论坛系统 ====================

function loadPosts(?string $category = null, int $page = 1): array {
    $posts = loadData(POSTS_FILE);
    if (!is_array($posts)) {
        return [[], 0];
    }
    
    if (!isAdmin() && !isReviewer()) {
        $posts = array_filter($posts, fn($p) => ($p['status'] ?? '') === PostStatus::APPROVED->value);
    }
    
    if ($category !== null && $category !== '') {
        $posts = array_filter($posts, fn($p) => ($p['category'] ?? '') === $category);
    }
    
    usort($posts, 'cmpPosts');
    $total = count($posts);
    $start = ($page - 1) * POSTS_PER_PAGE;
    $posts = array_slice(array_values($posts), $start, POSTS_PER_PAGE);
    
    return [$posts, $total];
}

function cmpPosts(array $a, array $b): int {
    $aSticky = $a['sticky'] ?? 0;
    $bSticky = $b['sticky'] ?? 0;
    if ($aSticky !== $bSticky) {
        return $bSticky <=> $aSticky;
    }
    $aTime = $a['time'] ?? 0;
    $bTime = $b['time'] ?? 0;
    return $bTime <=> $aTime;
}

function getPost(string $id): ?array {
    $posts = loadData(POSTS_FILE);
    if (!is_array($posts)) {
        return null;
    }
    foreach ($posts as $p) {
        if (($p['id'] ?? '') === $id) {
            return $p;
        }
    }
    return null;
}

function savePost(array $post): bool {
    $posts = loadData(POSTS_FILE);
    if (!is_array($posts)) {
        $posts = [];
    }
    $found = false;
    foreach ($posts as $k => $p) {
        if (($p['id'] ?? '') === ($post['id'] ?? '')) {
            $posts[$k] = $post;
            $found = true;
            break;
        }
    }
    if (!$found) {
        $posts[] = $post;
    }
    return saveData(POSTS_FILE, $posts);
}

function deletePost(string $id): bool {
    $posts = loadData(POSTS_FILE);
    if (!is_array($posts)) {
        return true;
    }
    $new = array_filter($posts, fn($p) => ($p['id'] ?? '') !== $id);
    $success = saveData(POSTS_FILE, array_values($new));
    if ($success) {
        addLog("帖子被删除: $id");
    }
    return $success;
}

function loadComments(string $postId): array {
    $comments = loadData(COMMENTS_FILE);
    if (!is_array($comments)) {
        return [];
    }
    return array_values(array_filter($comments, fn($c) => ($c['post_id'] ?? '') === $postId));
}

function saveComment(array $comment): bool {
    $comments = loadData(COMMENTS_FILE);
    if (!is_array($comments)) {
        $comments = [];
    }
    $comment['id'] = $comment['id'] ?? uniqid('', true);
    $comment['time'] = $comment['time'] ?? time();
    $comments[] = $comment;
    return saveData(COMMENTS_FILE, $comments);
}

function deleteComment(string $id): bool {
    $comments = loadData(COMMENTS_FILE);
    if (!is_array($comments)) {
        return true;
    }
    $new = array_filter($comments, fn($c) => ($c['id'] ?? '') !== $id);
    $success = saveData(COMMENTS_FILE, array_values($new));
    if ($success) {
        addLog("评论被删除: $id");
    }
    return $success;
}

function likePost(string $postId, string $userId): bool {
    $post = getPost($postId);
    if ($post === null) {
        return false;
    }
    if (!isset($post['likes'])) {
        $post['likes'] = [];
    }
    if (in_array($userId, $post['likes'], true)) {
        return false;
    }
    $post['likes'][] = $userId;
    if (isset($post['dislikes'])) {
        $post['dislikes'] = array_values(array_filter(
            $post['dislikes'],
            fn($d) => $d !== $userId
        ));
    }
    savePost($post);
    $users = loadUsers();
    if (isset($users[$post['author']])) {
        $users[$post['author']]['reputation'] = ($users[$post['author']]['reputation'] ?? 50) + 1;
        saveUsers($users);
    }
    return true;
}

function dislikePost(string $postId, string $userId): bool {
    $post = getPost($postId);
    if ($post === null) {
        return false;
    }
    if (!isset($post['dislikes'])) {
        $post['dislikes'] = [];
    }
    if (in_array($userId, $post['dislikes'], true)) {
        return false;
    }
    $post['dislikes'][] = $userId;
    if (isset($post['likes'])) {
        $post['likes'] = array_values(array_filter(
            $post['likes'],
            fn($l) => $l !== $userId
        ));
    }
    savePost($post);
    $users = loadUsers();
    if (isset($users[$post['author']])) {
        $users[$post['author']]['reputation'] = ($users[$post['author']]['reputation'] ?? 50) - 2;
        saveUsers($users);
    }
    return true;
}

// ==================== 广告系统 ====================

function loadAds(bool $activeOnly = true): array {
    $ads = loadData(ADS_FILE);
    if (!is_array($ads)) {
        return [];
    }
    if (!$activeOnly) {
        return $ads;
    }
    $now = time();
    return array_values(array_filter($ads, fn($a) =>
        ($a['status'] ?? '') === AdStatus::ACTIVE->value && ($a['end'] ?? 0) > $now
    ));
}

function saveAd(array $ad): bool {
    $ads = loadData(ADS_FILE);
    $ads = is_array($ads) ? $ads : [];
    $ads[] = $ad;
    return saveData(ADS_FILE, $ads);
}

function updateAd(string $id, array $data): bool {
    $ads = loadData(ADS_FILE);
    if (!is_array($ads)) {
        return false;
    }
    foreach ($ads as $k => $a) {
        if (($a['id'] ?? '') === $id) {
            foreach ($data as $key => $val) {
                $ads[$k][$key] = $val;
            }
            return saveData(ADS_FILE, $ads);
        }
    }
    return false;
}

function deleteAd(string $id): bool {
    $ads = loadData(ADS_FILE);
    if (!is_array($ads)) {
        return true;
    }
    $new = array_filter($ads, fn($a) => ($a['id'] ?? '') !== $id);
    return saveData(ADS_FILE, array_values($new));
}

// ==================== 法庭系统 ====================

function loadReports(?VoteResult $status = null): array {
    $reports = loadData(REPORTS_FILE);
    if (!is_array($reports)) {
        return [];
    }
    if ($status === null) {
        return $reports;
    }
    return array_values(array_filter($reports, fn($r) => ($r['status'] ?? '') === $status->value));
}

function saveReport(array $report): bool {
    $reports = loadData(REPORTS_FILE);
    $reports = is_array($reports) ? $reports : [];
    $reports[] = $report;
    return saveData(REPORTS_FILE, $reports);
}

function updateReport(string $id, array $data): bool {
    $reports = loadData(REPORTS_FILE);
    if (!is_array($reports)) {
        return false;
    }
    foreach ($reports as $k => $r) {
        if (($r['id'] ?? '') === $id) {
            foreach ($data as $key => $val) {
                $reports[$k][$key] = $val;
            }
            return saveData(REPORTS_FILE, $reports);
        }
    }
    return false;
}

function voteReport(string $reportId, string $user, VoteResult $vote): bool {
    $reports = loadData(REPORTS_FILE, true); // 强制刷新，避免并发
    if (!is_array($reports)) {
        return false;
    }
    foreach ($reports as $k => $r) {
        if (($r['id'] ?? '') === $reportId && ($r['status'] ?? '') === 'pending') {
            // 加锁防止并发多次投票（文件锁由 saveData 保证）
            if (!isset($reports[$k]['votes'])) {
                $reports[$k]['votes'] = [];
            }
            if (isset($reports[$k]['votes'][$user])) {
                return false;
            }
            $reports[$k]['votes'][$user] = $vote->value;
            $reports[$k]['votes_ban'] = ($reports[$k]['votes_ban'] ?? 0) + ($vote === VoteResult::BAN ? 1 : 0);
            $reports[$k]['votes_noban'] = ($reports[$k]['votes_noban'] ?? 0) + ($vote === VoteResult::NO_BAN ? 1 : 0);
            saveData(REPORTS_FILE, $reports);
            // 检查是否达到阈值
            if (($reports[$k]['votes_ban'] ?? 0) >= VOTE_BAN_THRESHOLD || ($reports[$k]['votes_noban'] ?? 0) >= VOTE_BAN_THRESHOLD) {
                $decision = ($reports[$k]['votes_ban'] ?? 0) > ($reports[$k]['votes_noban'] ?? 0)
                    ? VoteResult::BAN
                    : VoteResult::NO_BAN;
                judgeReport($reportId, $decision, false);
            }
            return true;
        }
    }
    return false;
}

function judgeReport(string $reportId, VoteResult $decision, bool $byAdmin = false): bool {
    $reports = loadData(REPORTS_FILE, true);
    $users = loadUsers();
    if (!is_array($reports)) {
        return false;
    }
    foreach ($reports as $k => $r) {
        if (($r['id'] ?? '') === $reportId && ($r['status'] ?? '') === 'pending') {
            $reports[$k]['status'] = 'judged';
            $reports[$k]['result'] = $decision->value;
            $reports[$k]['judged_by'] = $byAdmin ? 'admin' : 'vote';
            
            if ($decision === VoteResult::BAN) {
                if (isset($users[$r['reported'] ?? ''])) {
                    banUser($r['reported'], 24);
                    $users[$r['reported']]['reputation'] = ($users[$r['reported']]['reputation'] ?? 50) - 50;
                    $users[$r['reported']]['coin'] = ($users[$r['reported']]['coin'] ?? 100) - 50;
                }
                if (isset($users[$r['reporter'] ?? ''])) {
                    $users[$r['reporter']]['coin'] = ($users[$r['reporter']]['coin'] ?? 100) + 30;
                    $users[$r['reporter']]['reputation'] = ($users[$r['reporter']]['reputation'] ?? 50) + 10;
                }
                if (!empty($r['votes']) && is_array($r['votes'])) {
                    foreach ($r['votes'] as $voter => $vote) {
                        if ($vote === VoteResult::BAN->value && isset($users[$voter])) {
                            $users[$voter]['coin'] = ($users[$voter]['coin'] ?? 100) + 10;
                            $users[$voter]['reputation'] = ($users[$voter]['reputation'] ?? 50) + 2;
                        }
                    }
                }
            } else {
                if (isset($users[$r['reporter'] ?? ''])) {
                    $users[$r['reporter']]['reputation'] = ($users[$r['reporter']]['reputation'] ?? 50) - 30;
                    $users[$r['reporter']]['coin'] = ($users[$r['reporter']]['coin'] ?? 100) - 30;
                }
                if (isset($users[$r['reported'] ?? ''])) {
                    $users[$r['reported']]['coin'] = ($users[$r['reported']]['coin'] ?? 100) + 20;
                    $users[$r['reported']]['reputation'] = ($users[$r['reported']]['reputation'] ?? 50) + 5;
                }
                if (!empty($r['votes']) && is_array($r['votes'])) {
                    foreach ($r['votes'] as $voter => $vote) {
                        if ($vote === VoteResult::NO_BAN->value && isset($users[$voter])) {
                            $users[$voter]['coin'] = ($users[$voter]['coin'] ?? 100) + 5;
                            $users[$voter]['reputation'] = ($users[$voter]['reputation'] ?? 50) + 1;
                        }
                    }
                }
            }
            saveUsers($users);
            saveData(REPORTS_FILE, $reports);
            return true;
        }
    }
    return false;
}

// ==================== 自定义称号 ====================

function loadCustomTitles(): array {
    $titles = loadData(CUSTOM_TITLES_FILE);
    return is_array($titles) ? $titles : [];
}

function saveCustomTitles(array $titles): bool {
    return saveData(CUSTOM_TITLES_FILE, $titles);
}

function buyTitle(string $username, string $title): string {
    $users = loadUsers();
    if (!isset($users[$username])) {
        return '用户不存在';
    }
    $title = trim($title);
    if (strlen($title) < 1 || strlen($title) > 20) {
        return '称号长度必须在1-20字符';
    }
    $levelTitles = ['被封号', '新韭菜', '小韭菜', '青韭菜', '壮韭菜', '老韭菜', '韭菜头子', '韭菜王', '韭菜大亨', '韭菜资本家', '韭菜之神'];
    if (in_array($title, $levelTitles, true)) {
        return '该称号与系统默认称号重复，请选择其他';
    }
    $coin = $users[$username]['coin'] ?? 0;
    if ($coin < TITLE_PRICE) {
        return '余额不足，需要 ' . TITLE_PRICE . ' 资本币';
    }
    $titles = loadCustomTitles();
    foreach ($titles as $u => $t) {
        if ($t === $title && $u !== $username) {
            return '该称号已被他人使用';
        }
    }
    $users[$username]['coin'] = $coin - TITLE_PRICE;
    saveUsers($users);
    $titles[$username] = $title;
    saveCustomTitles($titles);
    addLog("用户 $username 购买称号: $title");
    return 'success';
}

function getUserTitle(string $username): string {
    $titles = loadCustomTitles();
    return $titles[$username] ?? '';
}

// ==================== 新闻系统 ====================

function loadNews(): array {
    $news = loadData(NEWS_FILE);
    return is_array($news) ? $news : [];
}

function saveNews(array $news): bool {
    return saveData(NEWS_FILE, $news);
}

function addNews(string $title, string $link = '', string $content = ''): bool {
    $news = loadNews();
    $news[] = [
        'id' => uniqid('', true),
        'title' => $title,
        'link' => $link,
        'content' => $content,
        'time' => time()
    ];
    if (count($news) > 20) {
        $news = array_slice($news, -20);
    }
    return saveNews($news);
}

function deleteNews(string $id): bool {
    $news = loadNews();
    $new = array_filter($news, fn($n) => ($n['id'] ?? '') !== $id);
    return saveNews(array_values($new));
}

// ==================== 操作日志 ====================

function addLog(string $action): bool {
    $logs = loadData(LOGS_FILE);
    $logs = is_array($logs) ? $logs : [];
    $logs[] = [
        'time' => time(),
        'user' => $_SESSION['user'] ?? 'system',
        'action' => $action
    ];
    if (count($logs) > 100) {
        $logs = array_slice($logs, -100);
    }
    return saveData(LOGS_FILE, $logs);
}

function getLogs(int $count = 50): array {
    $logs = loadData(LOGS_FILE);
    if (!is_array($logs)) {
        return [];
    }
    $logs = array_reverse($logs);
    return array_slice($logs, 0, $count);
}

// ==================== 弹幕系统 ====================

function loadDanmaku(string $postId): array {
    $danmaku = loadData(DANMAKU_FILE);
    if (!is_array($danmaku)) {
        return [];
    }
    return $danmaku[$postId] ?? [];
}

function saveDanmaku(string $postId, array $danmakuData): bool {
    $all = loadData(DANMAKU_FILE);
    if (!is_array($all)) {
        $all = [];
    }
    $all[$postId] = $danmakuData;
    if (count($all[$postId]) > DANMAKU_MAX) {
        $all[$postId] = array_slice($all[$postId], -DANMAKU_MAX);
    }
    return saveData(DANMAKU_FILE, $all);
}

function addDanmaku(
    string $postId,
    string $user,
    string $nickname,
    string $text,
    string $color = '#ffffff',
    int $size = 14,
    DanmakuPosition $position = DanmakuPosition::SCROLL
): bool {
    if ($text === '' || $user === '') {
        return false;
    }
    $danmaku = loadDanmaku($postId);
    if (!is_array($danmaku)) {
        $danmaku = [];
    }
    $danmaku[] = [
        'id' => uniqid('', true),
        'user' => $user,
        'nickname' => $nickname,
        'text' => $text,
        'color' => $color,
        'size' => $size,
        'position' => $position->value,
        'time' => time(),
        'ip' => $_SERVER['REMOTE_ADDR'] ?? ''
    ];
    return saveDanmaku($postId, $danmaku);
}

// ==================== 付费帖子 ====================

function getPaidPosts(): array {
    $paid = loadData(PAID_POST_FILE);
    return is_array($paid) ? $paid : [];
}

function savePaidPosts(array $paid): bool {
    return saveData(PAID_POST_FILE, $paid);
}

function setPostPrice(string $postId, int $price): bool {
    $paid = getPaidPosts();
    $buyers = $paid[$postId]['buyers'] ?? [];
    $paid[$postId] = [
        'price' => $price,
        'created' => time(),
        'buyers' => $buyers
    ];
    return savePaidPosts($paid);
}

function getPostPrice(string $postId): int {
    $paid = getPaidPosts();
    return $paid[$postId]['price'] ?? 0;
}

function hasUserPaid(string $postId, string $user): bool {
    if ($user === '') {
        return false;
    }
    $paid = getPaidPosts();
    if (!isset($paid[$postId])) {
        return true;
    }
    if ($paid[$postId]['price'] <= 0) {
        return true;
    }
    $post = getPost($postId);
    if ($post && ($post['author'] ?? '') === $user) {
        return true;
    }
    if (isAdmin()) {
        return true;
    }
    return in_array($user, $paid[$postId]['buyers'] ?? [], true);
}

function markPostPaid(string $postId, string $user): bool {
    $paid = getPaidPosts();
    if (!isset($paid[$postId])) {
        return false;
    }
    if (!isset($paid[$postId]['buyers'])) {
        $paid[$postId]['buyers'] = [];
    }
    if (!in_array($user, $paid[$postId]['buyers'], true)) {
        $paid[$postId]['buyers'][] = $user;
        return savePaidPosts($paid);
    }
    return true;
}

// ==================== 打赏系统 ====================

function loadDonations(string $postId = ''): array {
    $donations = loadData(DONATE_FILE);
    if (!is_array($donations)) {
        return [];
    }
    if ($postId !== '') {
        return array_values(array_filter($donations, fn($d) => ($d['post_id'] ?? '') === $postId));
    }
    return $donations;
}

function addDonation(
    string $fromUser,
    string $toUser,
    string $postId,
    int $amount,
    string $message = ''
): string {
    if ($amount <= 0) {
        return '金额必须大于0';
    }
    $users = loadUsers();
    if (!isset($users[$fromUser]) || !isset($users[$toUser])) {
        return '用户不存在';
    }
    if (($users[$fromUser]['coin'] ?? 0) < $amount) {
        return '资本币不足';
    }
    $users[$fromUser]['coin'] -= $amount;
    $users[$toUser]['coin'] = ($users[$toUser]['coin'] ?? 0) + $amount;
    $users[$fromUser]['reputation'] = ($users[$fromUser]['reputation'] ?? 50) + 1;
    $users[$fromUser]['exp'] = ($users[$fromUser]['exp'] ?? 0) + 5;
    $users[$fromUser]['level'] = getLevel((int)$users[$fromUser]['exp']);
    saveUsers($users);
    $donations = loadDonations();
    if (!is_array($donations)) {
        $donations = [];
    }
    $donations[] = [
        'id' => uniqid('', true),
        'from' => $fromUser,
        'to' => $toUser,
        'post_id' => $postId,
        'amount' => $amount,
        'message' => $message,
        'time' => time()
    ];
    saveData(DONATE_FILE, $donations);
    addLog("用户 $fromUser 打赏 $toUser $amount 资本币");
    return 'success';
}

// ==================== 辅助函数 ====================

function isAdmin(): bool {
    global $currentUser;
    return ($currentUser && ($currentUser['role'] ?? '') === 'admin');
}

function isReviewer(): bool {
    global $currentUser;
    return ($currentUser && ($currentUser['role'] ?? '') === 'reviewer');
}

function h(?string $s): string {
    if ($s === null) {
        return '';
    }
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

// ==================== 只读配置类 ====================

readonly class SiteConfig {
    public function __construct(
        public string $adminPasswordHash,
        public string $reviewerPasswordHash,
        public string $siteTitle,
        public string $noticeText,
        public bool $showNotice,
        public string $bgMusicUrl,
        public string $coinName,
        public string $coinSign,
        public int $initialCoin,
        public int $maxMessages,
        public int $recallTimeout,
        public int $adPrice,
        public int $adDuration,
        public array $categories,
        public int $titlePrice,
        public int $minDonate,
        public int $maxDonate,
        public bool $danmakuEnabled
    ) {}
    
    public static function load(): self {
        $default = [
            'admin_password_hash' => hashPassword('admin123'),
            'reviewer_password_hash' => hashPassword('admin123'),
            'site_title' => '💬 资本家社区',
            'notice_text' => '📢 欢迎来到资本家社区',
            'show_notice' => true,
            'bg_music_url' => 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
            'coin_name' => '资本币',
            'coin_sign' => '💰',
            'initial_coin' => 100,
            'max_messages' => MAX_MESSAGES,
            'recall_timeout' => RECALL_TIMEOUT,
            'ad_price' => 100,
            'ad_duration' => 7,
            'categories' => ['闲聊', '技术', '资源', '求助', '公告'],
            'title_price' => TITLE_PRICE,
            'min_donate' => 1,
            'max_donate' => 1000,
            'danmaku_enabled' => true
        ];
        $config = loadData(DATA_FILE);
        $merged = array_merge($default, is_array($config) ? $config : []);
        return new self(
            adminPasswordHash: $merged['admin_password_hash'],
            reviewerPasswordHash: $merged['reviewer_password_hash'],
            siteTitle: $merged['site_title'],
            noticeText: $merged['notice_text'],
            showNotice: (bool)$merged['show_notice'],
            bgMusicUrl: $merged['bg_music_url'],
            coinName: $merged['coin_name'],
            coinSign: $merged['coin_sign'],
            initialCoin: (int)$merged['initial_coin'],
            maxMessages: (int)$merged['max_messages'],
            recallTimeout: (int)$merged['recall_timeout'],
            adPrice: (int)$merged['ad_price'],
            adDuration: (int)$merged['ad_duration'],
            categories: $merged['categories'],
            titlePrice: (int)$merged['title_price'],
            minDonate: (int)$merged['min_donate'],
            maxDonate: (int)$merged['max_donate'],
            danmakuEnabled: (bool)$merged['danmaku_enabled']
        );
    }
}

// ==================== 初始化 ====================

$CONFIG = SiteConfig::load();
$users = loadUsers();
$chats = loadData(CHAT_FILE);

if (!is_array($chats)) {
    $chats = [];
}

if (empty($chats['official'])) {
    $chats['official'] = [
        'id' => 'official',
        'name' => '官方大厅',
        'cover' => '',
        'type' => 'public',
        'owner' => 'admin',
        'admins' => [],
        'members' => [],
        'pending' => [],
        'settings' => [
            'require_approval' => 0,
            'all_muted' => 0,
            'max_members' => 1000
        ],
        'created' => time(),
        'last_active' => time()
    ];
    saveData(CHAT_FILE, $chats);
}

if (!file_exists(CATEGORIES_FILE)) {
    saveData(CATEGORIES_FILE, $CONFIG->categories);
}

$login_error = '';
$reg_error = '';
$reg_success = '';
$message = '';
$messageType = '';
$currentUser = null;

$sessionUser = $_SESSION['user'] ?? '';
if ($sessionUser !== '' && isset($users[$sessionUser])) {
    $currentUser = $users[$sessionUser];
}

// 如果管理员登录但没有对应的用户记录，自动创建（仅当 admin 用户不存在时）
if (isset($_SESSION['admin']) && $_SESSION['admin'] === true && !isset($users['admin'])) {
    $users['admin'] = [
        'password' => $CONFIG->adminPasswordHash,
        'nickname' => '超级管理员',
        'avatar' => 'default.jpg',
        'reg_time' => time(),
        'level' => 100,
        'exp' => 999999,
        'coin' => 999999,
        'reputation' => 1000,
        'trusted' => 1,
        'role' => 'admin',
        'last_sign' => '',
        'sign_count' => 0,
        'today_posts' => 0,
        'last_post_date' => '',
        'votes_today' => 100,
        'last_vote_reset' => date('Y-m-d'),
        'latitude' => null,
        'longitude' => null,
        'location_sharing' => 0
    ];
    saveUsers($users);
    $_SESSION['user'] = 'admin';
    $currentUser = $users['admin'];
}

if (isset($_SESSION['reviewer']) && $_SESSION['reviewer'] === true && !isset($users['reviewer'])) {
    $users['reviewer'] = [
        'password' => $CONFIG->reviewerPasswordHash,
        'nickname' => '审核员',
        'avatar' => 'default.jpg',
        'reg_time' => time(),
        'level' => 50,
        'exp' => 50000,
        'coin' => 5000,
        'reputation' => 200,
        'trusted' => 1,
        'role' => 'reviewer',
        'last_sign' => '',
        'sign_count' => 0,
        'today_posts' => 0,
        'last_post_date' => '',
        'votes_today' => 20,
        'last_vote_reset' => date('Y-m-d'),
        'latitude' => null,
        'longitude' => null,
        'location_sharing' => 0
    ];
    saveUsers($users);
    $_SESSION['user'] = 'reviewer';
    $currentUser = $users['reviewer'];
}

if ($currentUser !== null && isBanned($currentUser)) {
    session_destroy();
    $currentUser = null;
    $login_error = '账号已被封禁';
}

if ($currentUser !== null) {
    updateOnline($_SESSION['user']);
    if (!isset($chats['official']['members'][$_SESSION['user']])) {
        autoJoinOfficial($_SESSION['user']);
        $chats = loadData(CHAT_FILE);
    }
}

if ($currentUser !== null && (isAdmin() || isReviewer())) {
    syncAdminsToAllChats();
    $chats = loadData(CHAT_FILE);
}

$tab = $_GET['tab'] ?? 'forum';
$page = max(1, (int)($_GET['page'] ?? 1));
$category = $_GET['category'] ?? '';
$post_id = $_GET['post'] ?? '';

$allComments = loadData(COMMENTS_FILE);
$comment_counts = [];

if (is_array($allComments)) {
    foreach ($allComments as $c) {
        $pid = $c['post_id'] ?? '';
        if ($pid !== '') {
            $comment_counts[$pid] = ($comment_counts[$pid] ?? 0) + 1;
        }
    }
}

$posts = [];
$totalPosts = 0;
$totalPages = 0;
$currentPost = null;
$comments = [];

if ($tab === 'forum') {
    if ($post_id !== '') {
        $currentPost = getPost($post_id);
        if ($currentPost) {
            // 增加浏览量
            $currentPost['views'] = ($currentPost['views'] ?? 0) + 1;
            savePost($currentPost);
        }
        $comments = $currentPost !== null ? loadComments($post_id) : [];
    } else {
        [$posts, $totalPosts] = loadPosts($category, $page);
        $totalPages = $totalPosts > 0 ? (int)ceil($totalPosts / POSTS_PER_PAGE) : 1;
    }
}

$room_id = $_GET['room'] ?? 'official';
$private_with = $_GET['private'] ?? '';
$roomMessages = [];
$currentRoom = null;
$last_msg_time = 0;

if ($private_with !== '' && $currentUser !== null) {
    $room_id = getPrivateRoomId($_SESSION['user'], $private_with);
    $roomMessages = loadMessages($room_id);
    $currentRoom = null;
} else {
    $currentRoom = $chats[$room_id] ?? null;
    $roomMessages = $currentRoom !== null ? loadMessages($room_id) : [];
}

if (!empty($roomMessages)) {
    $times = array_column($roomMessages, 't');
    $last_msg_time = max($times);
}

if ($currentUser !== null && !isset($chats['official']['members'][$_SESSION['user']])) {
    autoJoinOfficial($_SESSION['user']);
    $chats = loadData(CHAT_FILE);
    if (!is_array($chats)) {
        $chats = [];
    }
}

$private_list = [];
$all_msgs = loadData(MESSAGES_FILE);
if (is_array($all_msgs)) {
    foreach ($all_msgs as $rid => $msgs) {
        if (str_starts_with($rid, 'p_') && is_array($msgs) && !empty($msgs)) {
            $lastMsg = null;
            foreach ($msgs as $m) {
                $lastMsg = $m;
            }
            if ($lastMsg) {
                $other = ($lastMsg['u'] ?? '') === $_SESSION['user']
                    ? ($lastMsg['v'] ?? '')
                    : ($lastMsg['u'] ?? '');
                if ($other !== '' && $other !== $_SESSION['user'] && !in_array($other, $private_list, true)) {
                    $private_list[] = $other;
                }
            }
        }
    }
}

$reports = loadReports(VoteResult::PENDING);
$allReports = loadData(REPORTS_FILE);
$myReports = [];

if ($currentUser !== null && is_array($allReports)) {
    foreach ($allReports as $r) {
        if (($r['reporter'] ?? '') === $_SESSION['user'] || ($r['reported'] ?? '') === $_SESSION['user']) {
            $myReports[] = $r;
        }
    }
}

$ads = loadAds(true);
$topAds = array_slice($ads, 0, 5);
shuffle($topAds);
$sidebarAd = !empty($ads) ? $ads[array_rand($ads)] : null;

$allPosts = loadData(POSTS_FILE);
$hotPosts = [];

if (is_array($allPosts)) {
    usort($allPosts, fn($a, $b) => ($b['views'] ?? 0) <=> ($a['views'] ?? 0));
    $hotPosts = array_slice($allPosts, 0, 5);
}

$newsList = loadNews();
$newsList = array_reverse($newsList);
$newsList = array_slice($newsList, 0, 10);

$reservedUsernames = ['admin', 'reviewer', 'system', 'administrator', 'root'];

// ==================== 请求处理 ====================

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    
    try {
        if (in_array($action, ['login', 'admin_login', 'reviewer_login', 'register', 'logout'], true)) {
            // 无需令牌验证
        } else {
            if ($currentUser === null) {
                $message = '请先登录';
                $messageType = 'error';
                goto after_action;
            } else {
                $token = $_POST['token'] ?? '';
                if (!verifyToken($_SESSION['user'], $token)) {
                    $message = '安全验证失败，请刷新页面重试';
                    $messageType = 'error';
                    goto after_action;
                }
            }
        }
        
        if (in_array($action, ['login', 'admin_login', 'reviewer_login'], true)) {
            $pwd = $_POST['password'] ?? '';
            
            if ($action === 'login') {
                $user = trim($_POST['username'] ?? '');
                if (isset($users[$user]) && verifyPassword($pwd, $users[$user]['password'])) {
                    $_SESSION['user'] = $user;
                    $_SESSION['token'] = generateToken($user);
                } else {
                    $login_error = '用户名或密码错误';
                }
            } elseif ($action === 'admin_login') {
                $hash = $CONFIG->adminPasswordHash;
                if (verifyPassword($pwd, $hash)) {
                    $username = 'admin';
                    if (!isset($users[$username])) {
                        $users[$username] = [
                            'password' => $hash,
                            'nickname' => '超级管理员',
                            'avatar' => 'default.jpg',
                            'reg_time' => time(),
                            'level' => 100,
                            'exp' => 999999,
                            'coin' => 999999,
                            'reputation' => 1000,
                            'trusted' => 1,
                            'role' => 'admin',
                            'last_sign' => '',
                            'sign_count' => 0,
                            'today_posts' => 0,
                            'last_post_date' => '',
                            'votes_today' => 100,
                            'last_vote_reset' => date('Y-m-d'),
                            'latitude' => null,
                            'longitude' => null,
                            'location_sharing' => 0
                        ];
                        saveUsers($users);
                    }
                    $_SESSION['admin'] = true;
                    $_SESSION['user'] = $username;
                    $_SESSION['token'] = generateToken($username);
                } else {
                    $login_error = '管理员密码错误';
                }
            } elseif ($action === 'reviewer_login') {
                $hash = $CONFIG->reviewerPasswordHash;
                if (verifyPassword($pwd, $hash)) {
                    $username = 'reviewer';
                    if (!isset($users[$username])) {
                        $users[$username] = [
                            'password' => $hash,
                            'nickname' => '审核员',
                            'avatar' => 'default.jpg',
                            'reg_time' => time(),
                            'level' => 50,
                            'exp' => 50000,
                            'coin' => 5000,
                            'reputation' => 200,
                            'trusted' => 1,
                            'role' => 'reviewer',
                            'last_sign' => '',
                            'sign_count' => 0,
                            'today_posts' => 0,
                            'last_post_date' => '',
                            'votes_today' => 20,
                            'last_vote_reset' => date('Y-m-d'),
                            'latitude' => null,
                            'longitude' => null,
                            'location_sharing' => 0
                        ];
                        saveUsers($users);
                    }
                    $_SESSION['reviewer'] = true;
                    $_SESSION['user'] = $username;
                    $_SESSION['token'] = generateToken($username);
                } else {
                    $login_error = '审核员密码错误';
                }
            }
            
            if ($login_error === '') {
                header('Location: ' . $_SERVER['PHP_SELF']);
                exit;
            }
        }
        
        elseif ($action === 'register') {
            $user = trim($_POST['username'] ?? '');
            $password = $_POST['password'] ?? '';
            $confirm = $_POST['confirm_password'] ?? '';
            
            if (in_array(strtolower($user), array_map('strtolower', $reservedUsernames))) {
                $reg_error = '用户名不可用，请选择其他用户名';
            } elseif ($user === '' || $password === '') {
                $reg_error = '用户名和密码不能为空';
            } elseif ($password !== $confirm) {
                $reg_error = '两次密码不一致';
            } elseif (isset($users[$user])) {
                $reg_error = '用户名已存在';
            } elseif (strlen($user) < 3 || strlen($user) > 20) {
                $reg_error = '用户名长度3-20位';
            } elseif (!preg_match('/^[a-zA-Z0-9_\x{4e00}-\x{9fa5}]+$/u', $user)) {
                $reg_error = '用户名只能包含字母、数字、下划线和中文字符';
            } else {
                $users[$user] = [
                    'password' => hashPassword($password),
                    'nickname' => !empty($_POST['nickname']) ? trim($_POST['nickname']) : $user,
                    'avatar' => 'default.jpg',
                    'reg_time' => time(),
                    'level' => 1,
                    'exp' => 0,
                    'coin' => $CONFIG->initialCoin,
                    'reputation' => 50,
                    'trusted' => 0,
                    'role' => 'user',
                    'last_sign' => '',
                    'sign_count' => 0,
                    'today_posts' => 0,
                    'last_post_date' => '',
                    'votes_today' => 10,
                    'last_vote_reset' => date('Y-m-d'),
                    'latitude' => null,
                    'longitude' => null,
                    'location_sharing' => 0
                ];
                if (saveUsers($users)) {
                    autoJoinOfficial($user);
                    $reg_success = '注册成功，请登录';
                } else {
                    $reg_error = '注册失败，请重试';
                }
            }
        }
        
        elseif ($action === 'logout') {
            session_destroy();
            header('Location: ' . $_SERVER['PHP_SELF']);
            exit;
        }
        
        // AJAX 请求
        elseif ($action === 'get_new_messages' && $currentUser !== null) {
            $room = $_POST['room_id'] ?? '';
            $last = (int)($_POST['last_time'] ?? 0);
            $msgs = loadMessages($room, $last);
            foreach ($msgs as $msg) {
                if (is_array($msg) && ($msg['u'] ?? '') !== $_SESSION['user'] && isset($msg['id'])) {
                    markMessageRead($room, $msg['id'], $_SESSION['user']);
                }
            }
            header('Content-Type: application/json');
            echo json_encode(['success' => true, 'messages' => $msgs]);
            exit;
        }
        
        elseif ($action === 'send_chat' && $currentUser !== null) {
            $room = $_POST['room_id'] ?? '';
            $msg = trim($_POST['message'] ?? '');
            
            if ($msg === '') {
                $res = ['success' => false, 'error' => '消息不能为空'];
            } elseif (!isset($chats[$room])) {
                $res = ['success' => false, 'error' => '聊天室不存在'];
            } else {
                // 检查权限并自动加入（如果是管理员）
                if (!isset($chats[$room]['members'][$_SESSION['user']]) && (isAdmin() || isReviewer())) {
                    $chats[$room]['members'][$_SESSION['user']] = [
                        'role' => 'member',
                        'muted' => 0,
                        'joined' => time()
                    ];
                    saveData(CHAT_FILE, $chats); // 保存自动加入
                }
                
                if (!canSend($_SESSION['user'], $chats[$room])) {
                    $res = ['success' => false, 'error' => '你已被禁言或未加入'];
                } else {
                    $msgData = saveMessage($room, $_SESSION['user'], $currentUser['nickname'] ?? $_SESSION['user'], $msg);
                    $chats[$room]['last_active'] = time();
                    saveData(CHAT_FILE, $chats);
                    $res = ['success' => true, 'message' => $msgData];
                }
            }
            header('Content-Type: application/json');
            echo json_encode($res);
            exit;
        }
        
        elseif ($action === 'send_private' && $currentUser !== null) {
            $to = $_POST['to'] ?? '';
            $msg = trim($_POST['message'] ?? '');
            
            if ($msg === '') {
                $res = ['success' => false, 'error' => '消息不能为空'];
            } elseif (!isset($users[$to])) {
                $res = ['success' => false, 'error' => '用户不存在'];
            } elseif (isBlocked($_SESSION['user'], $to)) {
                $res = ['success' => false, 'error' => '你已拉黑该用户'];
            } else {
                $room = getPrivateRoomId($_SESSION['user'], $to);
                $msgData = saveMessage($room, $_SESSION['user'], $currentUser['nickname'] ?? $_SESSION['user'], $msg, $to);
                $res = ['success' => true, 'message' => $msgData];
            }
            header('Content-Type: application/json');
            echo json_encode($res);
            exit;
        }
        
        elseif ($action === 'recall_message' && $currentUser !== null) {
            $room = $_POST['room_id'] ?? '';
            $msgId = $_POST['msg_id'] ?? '';
            $isAdmin = isAdmin() || isReviewer();
            if (recallMessage($room, $msgId, $_SESSION['user'], $isAdmin)) {
                $res = ['success' => true];
            } else {
                $res = ['success' => false, 'error' => '无法撤回'];
            }
            header('Content-Type: application/json');
            echo json_encode($res);
            exit;
        }
        
        elseif ($action === 'edit_message' && $currentUser !== null) {
            $room = $_POST['room_id'] ?? '';
            $msgId = $_POST['msg_id'] ?? '';
            $newMsg = trim($_POST['new_msg'] ?? '');
            $isAdmin = isAdmin() || isReviewer();
            if ($newMsg === '') {
                $res = ['success' => false, 'error' => '消息不能为空'];
            } elseif (editMessage($room, $msgId, $_SESSION['user'], $newMsg, $isAdmin)) {
                $res = ['success' => true];
            } else {
                $res = ['success' => false, 'error' => '编辑失败'];
            }
            header('Content-Type: application/json');
            echo json_encode($res);
            exit;
        }
        
        elseif ($action === 'get_history' && $currentUser !== null) {
            $room = $_POST['room_id'] ?? '';
            $msgId = $_POST['msg_id'] ?? '';
            $history = getMessageHistory($room, $msgId);
            echo json_encode(['success' => true, 'history' => $history]);
            exit;
        }
        
        elseif ($action === 'send_danmaku' && $currentUser !== null) {
            $postId = $_POST['post_id'] ?? '';
            $text = trim($_POST['text'] ?? '');
            $color = $_POST['color'] ?? '#ffffff';
            $size = (int)($_POST['size'] ?? 14);
            $position = DanmakuPosition::from((int)($_POST['position'] ?? 0));
            if ($text === '') {
                echo json_encode(['success' => false, 'error' => '弹幕不能为空']);
                exit;
            }
            if (strlen($text) > 50) {
                echo json_encode(['success' => false, 'error' => '弹幕最多50字符']);
                exit;
            }
            if (addDanmaku($postId, $_SESSION['user'], $currentUser['nickname'] ?? $_SESSION['user'], $text, $color, $size, $position)) {
                echo json_encode(['success' => true]);
            } else {
                echo json_encode(['success' => false, 'error' => '发送失败']);
            }
            exit;
        }
        
        elseif ($action === 'get_danmaku' && $currentUser !== null) {
            $postId = $_POST['post_id'] ?? '';
            $danmaku = loadDanmaku($postId);
            echo json_encode(['success' => true, 'danmaku' => $danmaku]);
            exit;
        }
        
        elseif ($action === 'donate' && $currentUser !== null) {
            $to = $_POST['to_user'] ?? '';
            $postId = $_POST['post_id'] ?? '';
            $amount = (int)($_POST['amount'] ?? 0);
            $msg = trim($_POST['message'] ?? '');
            if ($amount < 1) {
                $message = '打赏金额不能少于1';
                $messageType = 'error';
            } else {
                $result = addDonation($_SESSION['user'], $to, $postId, $amount, $msg);
                if ($result === 'success') {
                    $message = '打赏成功！';
                    $messageType = 'success';
                } else {
                    $message = $result;
                    $messageType = 'error';
                }
            }
        }
        
        elseif ($action === 'buy_post' && $currentUser !== null) {
            $postId = $_POST['post_id'] ?? '';
            $post = getPost($postId);
            if ($post === null) {
                $message = '帖子不存在';
                $messageType = 'error';
            } else {
                $price = getPostPrice($postId);
                if ($price <= 0) {
                    $message = '该帖子免费';
                    $messageType = 'error';
                } elseif (hasUserPaid($postId, $_SESSION['user'])) {
                    $message = '你已经购买过了';
                    $messageType = 'error';
                } elseif (($currentUser['coin'] ?? 0) < $price) {
                    $message = '资本币不足，需要 ' . $price;
                    $messageType = 'error';
                } else {
                    $users = loadUsers();
                    $users[$_SESSION['user']]['coin'] -= $price;
                    $users[$post['author']]['coin'] = ($users[$post['author']]['coin'] ?? 0) + $price;
                    if (saveUsers($users)) {
                        markPostPaid($postId, $_SESSION['user']);
                        $message = '购买成功！';
                        $messageType = 'success';
                        // 不用刷新，提示后重新加载
                    } else {
                        $message = '购买失败，请重试';
                        $messageType = 'error';
                    }
                }
            }
        }
        
        elseif ($action === 'set_post_price' && $currentUser !== null) {
            $postId = $_POST['post_id'] ?? '';
            $price = (int)($_POST['price'] ?? 0);
            $post = getPost($postId);
            if ($post === null) {
                $message = '帖子不存在';
                $messageType = 'error';
            } elseif (($post['author'] ?? '') !== $_SESSION['user'] && !isAdmin()) {
                $message = '只有作者可以设置价格';
                $messageType = 'error';
            } else {
                if (setPostPrice($postId, $price)) {
                    $message = $price > 0 ? "已设置为付费帖子，价格 {$price} 资本币" : '已设置为免费帖子';
                    $messageType = 'success';
                } else {
                    $message = '设置失败';
                    $messageType = 'error';
                }
            }
        }
        
        elseif ($action === 'new_post' && $currentUser !== null) {
            $title = trim($_POST['title'] ?? '');
            $content = trim($_POST['content'] ?? '');
            $cat = $_POST['category'] ?? '';
            if ($title === '' || $content === '') {
                $message = '标题和内容不能为空';
                $messageType = 'error';
            } else {
                $needReview = !isTrusted($currentUser) && !isAdmin() && !isReviewer();
                $sticky = 0;
                $forceLocation = false;
                
                if ($cat === '求助') {
                    $needReview = false;
                    $sticky = 1;
                    // 强制开启位置共享
                    if (empty($currentUser['location_sharing'])) {
                        $users = loadUsers();
                        $users[$_SESSION['user']]['location_sharing'] = 1;
                        if (saveUsers($users)) {
                            $currentUser = $users[$_SESSION['user']];
                            $forceLocation = true;
                        }
                    }
                }
                
                $post = [
                    'id' => uniqid('', true),
                    'title' => $title,
                    'content' => $content,
                    'author' => $_SESSION['user'],
                    'nickname' => $currentUser['nickname'] ?? $_SESSION['user'],
                    'time' => time(),
                    'category' => $cat,
                    'tags' => $_POST['tags'] ?? '',
                    'views' => 0,
                    'likes' => [],
                    'dislikes' => [],
                    'sticky' => $sticky,
                    'elite' => 0,
                    'status' => $needReview ? PostStatus::PENDING->value : PostStatus::APPROVED->value
                ];
                
                $posts = loadData(POSTS_FILE);
                if (!is_array($posts)) $posts = [];
                $posts[] = $post;
                if (saveData(POSTS_FILE, $posts)) {
                    if (!$needReview) {
                        $users = loadUsers();
                        $users[$_SESSION['user']]['exp'] = ($users[$_SESSION['user']]['exp'] ?? 0) + 30;
                        $users[$_SESSION['user']]['coin'] = ($users[$_SESSION['user']]['coin'] ?? 0) + 10;
                        $users[$_SESSION['user']]['reputation'] = ($users[$_SESSION['user']]['reputation'] ?? 50) + 5;
                        saveUsers($users);
                        $currentUser = $users[$_SESSION['user']];
                    }
                    if ($forceLocation) {
                        $message = '求助帖已发布，位置共享已开启，请允许浏览器获取位置以便获得帮助。';
                    } else {
                        $message = $needReview ? '帖子已提交审核' : '发帖成功';
                    }
                    $messageType = 'success';
                } else {
                    $message = '发帖失败，请重试';
                    $messageType = 'error';
                }
            }
        }
        
        elseif ($action === 'new_comment' && $currentUser !== null) {
            $postId = $_POST['post_id'] ?? '';
            $content = trim($_POST['content'] ?? '');
            if ($content === '') {
                $message = '评论不能为空';
                $messageType = 'error';
            } else {
                $comment = [
                    'id' => uniqid('', true),
                    'post_id' => $postId,
                    'author' => $_SESSION['user'],
                    'nickname' => $currentUser['nickname'] ?? $_SESSION['user'],
                    'content' => $content,
                    'time' => time()
                ];
                if (saveComment($comment)) {
                    $users[$_SESSION['user']]['exp'] = ($users[$_SESSION['user']]['exp'] ?? 0) + 5;
                    $users[$_SESSION['user']]['coin'] = ($users[$_SESSION['user']]['coin'] ?? 0) + 2;
                    $users[$_SESSION['user']]['reputation'] = ($users[$_SESSION['user']]['reputation'] ?? 50) + 1;
                    saveUsers($users);
                    $message = '评论成功';
                    $messageType = 'success';
                } else {
                    $message = '评论失败';
                    $messageType = 'error';
                }
            }
        }
        
        elseif ($action === 'like_post' && $currentUser !== null) {
            $postId = $_POST['post_id'] ?? '';
            if (likePost($postId, $_SESSION['user'])) {
                $message = '点赞成功';
            } else {
                $message = '操作失败';
            }
            $messageType = 'success';
        }
        
        elseif ($action === 'dislike_post' && $currentUser !== null) {
            $postId = $_POST['post_id'] ?? '';
            if (dislikePost($postId, $_SESSION['user'])) {
                $message = '点踩成功';
            } else {
                $message = '操作失败';
            }
            $messageType = 'success';
        }
        
        elseif ($action === 'post_ad' && $currentUser !== null) {
            $title = trim($_POST['title'] ?? '');
            $link = trim($_POST['link'] ?? '');
            if ($title === '' || $link === '') {
                $message = '请填写完整';
                $messageType = 'error';
            } else {
                $cost = $CONFIG->adPrice;
                $isAdmin = isAdmin() || isReviewer();
                if (!$isAdmin && ($currentUser['coin'] ?? 0) < $cost) {
                    $message = '资本币不足';
                    $messageType = 'error';
                } else {
                    $ad = [
                        'id' => uniqid('', true),
                        'title' => $title,
                        'link' => $link,
                        'image' => '',
                        'owner' => $_SESSION['user'],
                        'cost' => $isAdmin ? 0 : $cost,
                        'start' => time(),
                        'end' => time() + $CONFIG->adDuration * 86400,
                        'status' => $isAdmin ? AdStatus::ACTIVE->value : AdStatus::PENDING->value
                    ];
                    if (!empty($_FILES['ad_image']['name'])) {
                        if ($_FILES['ad_image']['error'] !== UPLOAD_ERR_OK) {
                            $message = '图片上传失败';
                            $messageType = 'error';
                            goto after_action;
                        }
                        if ($_FILES['ad_image']['size'] > MAX_FILE_SIZE) {
                            $message = '图片大小不能超过2MB';
                            $messageType = 'error';
                            goto after_action;
                        }
                        $finfo = finfo_open(FILEINFO_MIME_TYPE);
                        $mime = finfo_file($finfo, $_FILES['ad_image']['tmp_name']);
                        finfo_close($finfo);
                        $allowedMimes = ['image/jpeg', 'image/png', 'image/gif'];
                        if (!in_array($mime, $allowedMimes, true)) {
                            $message = '只支持JPEG、PNG、GIF格式的图片';
                            $messageType = 'error';
                            goto after_action;
                        }
                        $ext = match($mime) {
                            'image/jpeg' => 'jpg',
                            'image/png'  => 'png',
                            'image/gif'  => 'gif',
                            default      => ''
                        };
                        $filename = 'ad_' . uniqid('', true) . '.' . $ext;
                        $path = UPLOAD_DIR . 'ads/' . $filename;
                        if (!is_dir(UPLOAD_DIR . 'ads/')) {
                            mkdir(UPLOAD_DIR . 'ads/', 0777, true);
                        }
                        if (move_uploaded_file($_FILES['ad_image']['tmp_name'], $path)) {
                            $ad['image'] = $path;
                        } else {
                            $message = '图片保存失败';
                            $messageType = 'error';
                            goto after_action;
                        }
                    }
                    if (saveAd($ad)) {
                        if (!$isAdmin) {
                            $users[$_SESSION['user']]['coin'] = ($users[$_SESSION['user']]['coin'] ?? 0) - $cost;
                            saveUsers($users);
                        }
                        $message = $isAdmin ? '广告发布成功' : '广告已提交审核';
                        $messageType = 'success';
                    } else {
                        $message = '发布失败';
                        $messageType = 'error';
                    }
                }
            }
        }
        
        elseif ($action === 'report' && $currentUser !== null) {
            $reported = $_POST['reported'] ?? '';
            $reason = trim($_POST['reason'] ?? '');
            $evidence = trim($_POST['evidence'] ?? '');
            $anonymous = isset($_POST['anonymous']) ? 1 : 0;
            if ($reason === '') {
                $message = '举报理由不能为空';
                $messageType = 'error';
            } elseif (!isset($users[$reported])) {
                $message = '用户不存在';
                $messageType = 'error';
            } else {
                $report = [
                    'id' => uniqid('', true),
                    'reporter' => $_SESSION['user'],
                    'reporter_anonymous' => $anonymous,
                    'reported' => $reported,
                    'reason' => $reason,
                    'evidence' => $evidence,
                    'time' => time(),
                    'status' => 'pending',
                    'votes' => [],
                    'votes_ban' => 0,
                    'votes_noban' => 0
                ];
                if (saveReport($report)) {
                    $message = '举报已提交，等待公开法庭裁决';
                    $messageType = 'success';
                } else {
                    $message = '提交失败';
                    $messageType = 'error';
                }
            }
        }
        
        elseif ($action === 'vote_report' && $currentUser !== null) {
            $reportId = $_POST['report_id'] ?? '';
            $vote = $_POST['vote'] === 'ban' ? VoteResult::BAN : VoteResult::NO_BAN;
            // 检查今日投票次数（在每次投票前更新）
            $today = date('Y-m-d');
            if (($currentUser['last_vote_reset'] ?? '') !== $today) {
                $users[$_SESSION['user']]['votes_today'] = 10;
                $users[$_SESSION['user']]['last_vote_reset'] = $today;
                saveUsers($users);
                $currentUser = $users[$_SESSION['user']];
            }
            if (($currentUser['votes_today'] ?? 0) <= 0) {
                $message = '今日投票次数已用完';
                $messageType = 'error';
            } else {
                if (voteReport($reportId, $_SESSION['user'], $vote)) {
                    $users[$_SESSION['user']]['votes_today'] = ($currentUser['votes_today'] ?? 10) - 1;
                    saveUsers($users);
                    $message = '投票成功';
                    $messageType = 'success';
                } else {
                    $message = '投票失败';
                    $messageType = 'error';
                }
            }
        }
        
        elseif ($action === 'appeal' && $currentUser !== null) {
            $reason = trim($_POST['reason'] ?? '');
            if ($reason === '') {
                $message = '申诉理由不能为空';
                $messageType = 'error';
            } else {
                if (addAppeal($_SESSION['user'], $reason)) {
                    $message = '申诉已提交，等待处理';
                    $messageType = 'success';
                } else {
                    $message = '提交失败';
                    $messageType = 'error';
                }
            }
        }
        
        elseif ($action === 'sign' && $currentUser !== null) {
            $users = loadUsers();
            $msg = doSign($_SESSION['user'], $users, $CONFIG->initialCoin);
            if (saveUsers($users)) {
                $message = $msg;
            } else {
                $message = '签到失败，请重试';
            }
            $messageType = str_contains($message, '成功') ? 'success' : 'error';
        }
        
        elseif ($action === 'buy_title' && $currentUser !== null) {
            $title = trim($_POST['title'] ?? '');
            $result = buyTitle($_SESSION['user'], $title);
            if ($result === 'success') {
                $message = '称号购买成功！';
                $messageType = 'success';
                $users = loadUsers();
                $currentUser = $users[$_SESSION['user']];
            } else {
                $message = $result;
                $messageType = 'error';
            }
        }
        
        elseif ($action === 'create_chat' && $currentUser !== null) {
            $name = trim($_POST['name'] ?? '');
            if ($name === '') {
                $message = '名称不能为空';
                $messageType = 'error';
            } else {
                $roomId = uniqid('', true);
                $chats[$roomId] = [
                    'id' => $roomId,
                    'name' => $name,
                    'cover' => '',
                    'type' => $_POST['type'] ?? 'public',
                    'owner' => $_SESSION['user'],
                    'admins' => [],
                    'members' => [
                        $_SESSION['user'] => [
                            'role' => 'owner',
                            'muted' => 0,
                            'joined' => time()
                        ]
                    ],
                    'pending' => [],
                    'settings' => [
                        'require_approval' => isset($_POST['require_approval']) ? 1 : 0,
                        'all_muted' => 0,
                        'max_members' => 100
                    ],
                    'created' => time(),
                    'last_active' => time()
                ];
                $allUsers = loadUsers();
                $adminsAndReviewers = [];
                foreach ($allUsers as $name => $user) {
                    if (($user['role'] ?? '') === 'admin' || ($user['role'] ?? '') === 'reviewer') {
                        $adminsAndReviewers[] = $name;
                    }
                }
                foreach ($adminsAndReviewers as $name) {
                    if ($name !== $_SESSION['user']) {
                        $chats[$roomId]['members'][$name] = ['role' => 'member', 'muted' => 0, 'joined' => time()];
                        $chats[$roomId]['admins'][] = $name;
                    }
                }
                $chats[$roomId]['admins'] = array_unique($chats[$roomId]['admins']);
                
                if (($_POST['type'] ?? '') === 'private' && !empty($_POST['password'])) {
                    $chats[$roomId]['password'] = md5($_POST['password'] . 'capitalist');
                }
                if (saveData(CHAT_FILE, $chats)) {
                    $message = '创建成功';
                    $messageType = 'success';
                } else {
                    $message = '创建失败';
                    $messageType = 'error';
                }
            }
        }
        
        elseif (in_array($action, [
            'set_admin', 'remove_admin', 'mute_member', 'unmute_member',
            'kick_member', 'toggle_all_mute', 'delete_chatroom'
        ], true) && $currentUser !== null) {
            
            $roomId = $_POST['room_id'] ?? '';
            $target = $_POST['target'] ?? '';
            
            $chats = loadData(CHAT_FILE, true); // 强制刷新
            if (!isset($chats[$roomId])) {
                $message = '聊天室不存在';
                $messageType = 'error';
            } elseif (!canManage($_SESSION['user'], $chats[$roomId])) {
                $message = '没有权限';
                $messageType = 'error';
            } else {
                $room = &$chats[$roomId];
                
                if ($action === 'set_admin' && $target !== '' && !in_array($target, $room['admins'] ?? [], true)) {
                    $room['admins'][] = $target;
                    if (isset($room['members'][$target])) {
                        $room['members'][$target]['role'] = 'admin';
                    }
                    $message = '已设为管理员';
                }
                elseif ($action === 'remove_admin' && $target !== '') {
                    $key = array_search($target, $room['admins'] ?? [], true);
                    if ($key !== false) {
                        unset($room['admins'][$key]);
                        if (isset($room['members'][$target])) {
                            $room['members'][$target]['role'] = 'member';
                        }
                        $message = '已取消管理员';
                    }
                }
                elseif ($action === 'mute_member' && $target !== '' && isset($room['members'][$target])) {
                    $room['members'][$target]['muted'] = 1;
                    $message = '已禁言';
                }
                elseif ($action === 'unmute_member' && $target !== '' && isset($room['members'][$target])) {
                    $room['members'][$target]['muted'] = 0;
                    $message = '已解禁';
                }
                elseif ($action === 'kick_member' && $target !== '' && isset($room['members'][$target])) {
                    unset($room['members'][$target]);
                    $key = array_search($target, $room['admins'] ?? [], true);
                    if ($key !== false) {
                        unset($room['admins'][$key]);
                    }
                    $message = '已移除';
                }
                elseif ($action === 'toggle_all_mute') {
                    $room['settings']['all_muted'] = empty($room['settings']['all_muted']) ? 1 : 0;
                    $message = $room['settings']['all_muted'] ? '全员禁言已开启' : '全员禁言已关闭';
                }
                elseif ($action === 'delete_chatroom') {
                    if (($room['owner'] ?? '') === $_SESSION['user'] || isAdmin()) {
                        unset($chats[$roomId]);
                        $msgs = loadData(MESSAGES_FILE);
                        if (is_array($msgs) && isset($msgs[$roomId])) {
                            unset($msgs[$roomId]);
                            saveData(MESSAGES_FILE, $msgs);
                        }
                        $message = '聊天室已解散';
                    } else {
                        $message = '只有室主可以解散';
                    }
                }
                
                if (!empty($message)) {
                    if (saveData(CHAT_FILE, $chats)) {
                        $messageType = 'success';
                    } else {
                        $message = '操作失败，请重试';
                        $messageType = 'error';
                    }
                }
            }
        }
        
        elseif (in_array($action, ['add_friend', 'remove_friend', 'block_user', 'unblock_user', 'clear_private'], true) && $currentUser !== null) {
            $target = $_POST['target'] ?? $_POST['friend'] ?? '';
            if ($action === 'add_friend') {
                $result = addFriend($_SESSION['user'], $target);
                $message = $result ? '添加成功' : '添加失败';
            } elseif ($action === 'remove_friend') {
                $result = removeFriend($_SESSION['user'], $target);
                $message = $result ? '已删除' : '删除失败';
            } elseif ($action === 'block_user') {
                $result = blockUser($_SESSION['user'], $target);
                $message = $result ? '已拉黑' : '拉黑失败';
            } elseif ($action === 'unblock_user') {
                $result = unblockUser($_SESSION['user'], $target);
                $message = $result ? '已解除' : '解除失败';
            } elseif ($action === 'clear_private') {
                $room = getPrivateRoomId($_SESSION['user'], $target);
                $all = loadData(MESSAGES_FILE);
                if (is_array($all) && isset($all[$room])) {
                    unset($all[$room]);
                    $result = saveData(MESSAGES_FILE, $all);
                    $message = $result ? '已清空' : '清空失败';
                } else {
                    $message = '清空失败';
                }
            }
            $messageType = $message === '已清空' || $message === '添加成功' || $message === '已删除' || $message === '已拉黑' || $message === '已解除' ? 'success' : 'error';
        }
        
        elseif (in_array($action, ['ban_user', 'unban_user', 'delete_user', 'set_role', 'set_trusted', 'admin_edit_user', 'admin_edit_user_full', 'update_location_sharing', 'update_location', 'change_password'], true) && $currentUser !== null) {
            
            if (in_array($action, ['ban_user', 'unban_user', 'delete_user', 'set_role', 'set_trusted', 'admin_edit_user', 'admin_edit_user_full', 'update_location_sharing', 'update_location']) && !isAdmin()) {
                $message = '权限不足';
                $messageType = 'error';
                goto after_action;
            }
            
            $target = $_POST['username'] ?? $_POST['target_user'] ?? '';
            
            if ($action === 'change_password') {
                $old = $_POST['old_password'] ?? '';
                $new = $_POST['new_password'] ?? '';
                $confirm = $_POST['confirm_password'] ?? '';
                
                if ($new !== $confirm) {
                    $message = '两次新密码不一致';
                    $messageType = 'error';
                    goto after_action;
                }
                
                if (!verifyPassword($old, $currentUser['password'])) {
                    $message = '原密码错误';
                    $messageType = 'error';
                    goto after_action;
                }
                
                $users = loadUsers();
                $users[$_SESSION['user']]['password'] = hashPassword($new);
                if (saveUsers($users)) {
                    $message = '密码修改成功';
                    $messageType = 'success';
                    $currentUser = $users[$_SESSION['user']];
                } else {
                    $message = '保存失败';
                    $messageType = 'error';
                }
                goto after_action;
            }
            
            if ($target === 'admin' || $target === $_SESSION['user']) {
                $message = '不能操作超级管理员或自己';
                $messageType = 'error';
                goto after_action;
            }
            
            $users = loadUsers();
            if (!isset($users[$target])) {
                $message = '用户不存在';
                $messageType = 'error';
                goto after_action;
            }
            
            if ($action === 'ban_user') {
                $hours = (int)($_POST['hours'] ?? 24);
                $permanent = isset($_POST['permanent']);
                $users[$target]['banned'] = $permanent ? 'permanent' : (time() + $hours * 3600);
                if (saveUsers($users)) {
                    $message = $permanent ? '已永久封禁' : "已封禁 $hours 小时";
                    addLog("管理员封禁用户: $target" . ($permanent ? '永久' : " $hours 小时"));
                } else {
                    $message = '保存失败，请检查文件权限';
                    $messageType = 'error';
                }
            } elseif ($action === 'unban_user') {
                unset($users[$target]['banned']);
                if (saveUsers($users)) {
                    $message = '已解封';
                    addLog("管理员解封用户: $target");
                } else {
                    $message = '保存失败';
                    $messageType = 'error';
                }
            } elseif ($action === 'delete_user') {
                if (deleteUser($target)) {
                    $message = '已删除';
                } else {
                    $message = '删除失败';
                    $messageType = 'error';
                }
            } elseif ($action === 'set_role') {
                $role = $_POST['role'] ?? '';
                // 确保最后一个管理员不会被降级
                if ($role !== 'admin' && ($users[$target]['role'] ?? '') === 'admin') {
                    $adminCount = 0;
                    foreach ($users as $u) {
                        if (($u['role'] ?? '') === 'admin') $adminCount++;
                    }
                    if ($adminCount <= 1) {
                        $message = '无法降级最后一个管理员';
                        $messageType = 'error';
                        goto after_action;
                    }
                }
                $users[$target]['role'] = $role;
                if (saveUsers($users)) {
                    $message = "已设置为 $role";
                    addLog("管理员设置用户 $target 角色为 $role");
                } else {
                    $message = '保存失败';
                    $messageType = 'error';
                }
            } elseif ($action === 'set_trusted') {
                $trusted = (int)($_POST['trusted'] ?? 0);
                $users[$target]['trusted'] = $trusted ? 1 : 0;
                if (saveUsers($users)) {
                    $message = $trusted ? '已设为信任用户' : '已取消信任';
                    addLog("管理员设置用户 $target 信任状态为 $trusted");
                } else {
                    $message = '保存失败';
                    $messageType = 'error';
                }
            } elseif ($action === 'admin_edit_user') {
                if (isset($_POST['coin'])) $users[$target]['coin'] = (int)$_POST['coin'];
                if (isset($_POST['reputation'])) $users[$target]['reputation'] = (int)$_POST['reputation'];
                if (isset($_POST['exp'])) $users[$target]['exp'] = (int)$_POST['exp'];
                if (isset($_POST['level'])) $users[$target]['level'] = (int)$_POST['level'];
                $users[$target]['level'] = getLevel((int)$users[$target]['exp']);
                if (saveUsers($users)) {
                    $message = '用户数据已更新';
                    addLog("管理员编辑用户 $target 数据");
                } else {
                    $message = '保存失败';
                    $messageType = 'error';
                }
            } elseif ($action === 'admin_edit_user_full') {
                // 处理昵称
                if (!empty($_POST['nickname'])) {
                    $users[$target]['nickname'] = trim($_POST['nickname']);
                }
                // 处理密码
                if (!empty($_POST['new_password'])) {
                    $users[$target]['password'] = hashPassword($_POST['new_password']);
                }
                // 处理资本币、信誉、经验、等级
                if (isset($_POST['coin']) && $_POST['coin'] !== '') {
                    $users[$target]['coin'] = (int)$_POST['coin'];
                }
                if (isset($_POST['reputation']) && $_POST['reputation'] !== '') {
                    $users[$target]['reputation'] = (int)$_POST['reputation'];
                }
                if (isset($_POST['exp']) && $_POST['exp'] !== '') {
                    $users[$target]['exp'] = (int)$_POST['exp'];
                    // 自动计算等级（可选）
                    $users[$target]['level'] = getLevel($users[$target]['exp']);
                }
                if (isset($_POST['level']) && $_POST['level'] !== '') {
                    $users[$target]['level'] = (int)$_POST['level'];
                }
                // 处理位置共享
                if (isset($_POST['sharing'])) {
                    $users[$target]['location_sharing'] = (int)$_POST['sharing'];
                }
                if (saveUsers($users)) {
                    $message = '用户资料已更新';
                    addLog("管理员完整编辑用户 $target 资料");
                } else {
                    $message = '保存失败';
                    $messageType = 'error';
                }
            } elseif ($action === 'update_location_sharing') {
                $sharing = (int)($_POST['sharing'] ?? 0);
                $users[$target]['location_sharing'] = $sharing;
                if (saveUsers($users)) {
                    $message = '位置共享状态已更新';
                    addLog("管理员设置用户 $target 位置共享为 $sharing");
                } else {
                    $message = '保存失败';
                    $messageType = 'error';
                }
            } elseif ($action === 'update_location') {
                $lat = (float)($_POST['latitude'] ?? 0);
                $lng = (float)($_POST['longitude'] ?? 0);
                $users[$target]['latitude'] = $lat;
                $users[$target]['longitude'] = $lng;
                if (saveUsers($users)) {
                    $message = '用户位置已更新';
                    addLog("管理员更新用户 $target 位置");
                } else {
                    $message = '保存失败';
                    $messageType = 'error';
                }
            }
            
            if (!empty($message) && $messageType !== 'error') {
                $messageType = 'success';
            }
        }
        
        elseif ($action === 'update_my_location_sharing' && $currentUser !== null) {
            $sharing = (int)($_POST['sharing'] ?? 0);
            $users = loadUsers();
            $users[$_SESSION['user']]['location_sharing'] = $sharing;
            if (saveUsers($users)) {
                $currentUser = $users[$_SESSION['user']];
                echo json_encode(['success' => true]);
            } else {
                echo json_encode(['success' => false, 'error' => '保存失败']);
            }
            exit;
        }
        
        elseif ($action === 'update_my_location' && $currentUser !== null) {
            $lat = (float)($_POST['latitude'] ?? 0);
            $lng = (float)($_POST['longitude'] ?? 0);
            $users = loadUsers();
            $users[$_SESSION['user']]['latitude'] = $lat;
            $users[$_SESSION['user']]['longitude'] = $lng;
            if (saveUsers($users)) {
                $currentUser = $users[$_SESSION['user']];
                echo json_encode(['success' => true]);
            } else {
                echo json_encode(['success' => false, 'error' => '保存失败']);
            }
            exit;
        }
        
        elseif (in_array($action, ['approve_post', 'reject_post', 'sticky_post', 'elite_post', 'delete_post_admin'], true) && (isAdmin() || isReviewer())) {
            $postId = $_POST['post_id'] ?? '';
            $post = getPost($postId);
            if ($post === null) {
                $message = '帖子不存在';
            } else {
                if ($action === 'approve_post') {
                    $post['status'] = PostStatus::APPROVED->value;
                    if (savePost($post)) {
                        $users = loadUsers();
                        if (isset($users[$post['author']])) {
                            $users[$post['author']]['coin'] = ($users[$post['author']]['coin'] ?? 0) + 10;
                            $users[$post['author']]['reputation'] = ($users[$post['author']]['reputation'] ?? 50) + 5;
                            saveUsers($users);
                        }
                        $message = '已通过';
                    } else {
                        $message = '操作失败';
                    }
                } elseif ($action === 'reject_post') {
                    $message = deletePost($postId) ? '已拒绝' : '操作失败';
                } elseif ($action === 'sticky_post') {
                    $post['sticky'] = empty($post['sticky']) ? 1 : 0;
                    $message = savePost($post) ? (empty($post['sticky']) ? '已取消置顶' : '已置顶') : '操作失败';
                } elseif ($action === 'elite_post') {
                    $post['elite'] = empty($post['elite']) ? 1 : 0;
                    $message = savePost($post) ? (empty($post['elite']) ? '已取消精华' : '已设为精华') : '操作失败';
                } elseif ($action === 'delete_post_admin') {
                    $message = deletePost($postId) ? '已删除' : '操作失败';
                }
                if (!empty($message)) $messageType = 'success';
            }
        }
        
        elseif ($action === 'delete_comment_admin' && (isAdmin() || isReviewer())) {
            $commentId = $_POST['comment_id'] ?? '';
            $message = deleteComment($commentId) ? '评论已删除' : '删除失败';
            $messageType = $message === '评论已删除' ? 'success' : 'error';
        }
        
        elseif (in_array($action, ['approve_ad', 'reject_ad', 'delete_ad'], true) && (isAdmin() || isReviewer())) {
            $adId = $_POST['ad_id'] ?? '';
            if ($action === 'approve_ad') {
                $success = updateAd($adId, ['status' => AdStatus::ACTIVE->value]);
                $message = $success ? '广告已通过' : '操作失败';
            } elseif ($action === 'reject_ad') {
                $success = updateAd($adId, ['status' => AdStatus::REJECTED->value]);
                $message = $success ? '广告已拒绝' : '操作失败';
            } elseif ($action === 'delete_ad') {
                $success = deleteAd($adId);
                $message = $success ? '广告已删除' : '操作失败';
            }
            $messageType = !empty($message) ? 'success' : 'error';
        }
        
        elseif ($action === 'judge_report' && isAdmin()) {
            $reportId = $_POST['report_id'] ?? '';
            $decision = $_POST['decision'] === 'ban' ? VoteResult::BAN : VoteResult::NO_BAN;
            $message = judgeReport($reportId, $decision, true) ? '已判决' : '判决失败';
            $messageType = $message === '已判决' ? 'success' : 'error';
        }
        
        elseif ($action === 'handle_appeal' && isAdmin()) {
            $id = $_POST['appeal_id'] ?? '';
            $action2 = ($_POST['appeal_action'] ?? '') === 'accept' ? AppealStatus::ACCEPTED : AppealStatus::REJECTED;
            $message = handleAppeal($id, $action2) ? '申诉已处理' : '处理失败';
            $messageType = $message === '申诉已处理' ? 'success' : 'error';
        }
        
        elseif (in_array($action, ['add_news', 'delete_news'], true) && isAdmin()) {
            if ($action === 'add_news') {
                $title = trim($_POST['news_title'] ?? '');
                $link = trim($_POST['news_link'] ?? '');
                $content = trim($_POST['news_content'] ?? '');
                $message = addNews($title, $link, $content) ? '新闻已添加' : '添加失败';
            } else {
                $id = $_POST['news_id'] ?? '';
                $message = deleteNews($id) ? '新闻已删除' : '删除失败';
            }
            $messageType = $message === '新闻已添加' || $message === '新闻已删除' ? 'success' : 'error';
        }
        
        elseif (in_array($action, ['update_notice', 'update_music', 'update_config'], true) && isAdmin()) {
            $configData = loadData(DATA_FILE);
            if (!is_array($configData)) $configData = [];
            if ($action === 'update_notice') {
                $configData['notice_text'] = $_POST['notice_text'] ?? '';
                $configData['show_notice'] = isset($_POST['show_notice']) ? 1 : 0;
                $message = '公告已更新';
            } elseif ($action === 'update_music') {
                $configData['bg_music_url'] = $_POST['bg_music_url'] ?? '';
                $message = '音乐已更新';
            } elseif ($action === 'update_config') {
                $key = $_POST['config_key'] ?? '';
                $val = $_POST['config_value'] ?? '';
                $configData[$key] = $val;
                $message = '配置已更新';
            }
            if (saveData(DATA_FILE, $configData)) {
                $CONFIG = SiteConfig::load();
                $messageType = 'success';
            } else {
                $message = '保存失败';
                $messageType = 'error';
            }
        }
        
        elseif ($action === 'update_profile' && $currentUser !== null) {
            $nickname = trim($_POST['nickname'] ?? '');
            if ($nickname !== '') {
                $users[$_SESSION['user']]['nickname'] = $nickname;
            }
            if (!empty($_FILES['avatar']['name'])) {
                $filename = uploadAvatarSimple($_FILES['avatar'], $_SESSION['user']);
                if ($filename !== false) {
                    $users[$_SESSION['user']]['avatar'] = $filename;
                } else {
                    $message = '头像上传失败（格式或大小不正确）';
                    $messageType = 'error';
                    goto after_action;
                }
            }
            if (saveUsers($users)) {
                $message = '资料已更新';
                $messageType = 'success';
            } else {
                $message = '保存失败';
                $messageType = 'error';
            }
        }
        
    } catch (Throwable $e) {
        $message = '系统错误: ' . $e->getMessage();
        $messageType = 'error';
        error_log('Exception: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    }
}

after_action:

// ==================== 刷新数据 ====================

$users = loadUsers();
$chats = loadData(CHAT_FILE);
if (!is_array($chats)) $chats = [];
$friends = loadData(FRIENDS_FILE);
if (!is_array($friends)) $friends = [];
$blocks = loadData(BLOCKS_FILE);
if (!is_array($blocks)) $blocks = [];

$today = date('Y-m-d');
if ($currentUser !== null && (($currentUser['last_vote_reset'] ?? '') !== $today)) {
    $users[$_SESSION['user']]['votes_today'] = 10;
    $users[$_SESSION['user']]['last_vote_reset'] = $today;
    saveUsers($users);
    $currentUser = $users[$_SESSION['user']];
}

$customTitles = loadCustomTitles();
$userTitle = $currentUser !== null ? ($customTitles[$_SESSION['user']] ?? '') : '';
$logs = isAdmin() ? getLogs(50) : [];

// ==================== HTML 输出开始 ====================

?><!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=yes">
    <title><?php echo h($CONFIG->siteTitle); ?></title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            background: #0a0a0f; 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            color: #e0e0e0; 
            line-height: 1.5; 
            padding-bottom: 60px; 
        }
        .container { max-width: 1400px; margin: 0 auto; padding: 0 15px; }
        
        .notice-bar {
            background: linear-gradient(90deg, #4a00e0, #ff8c00);
            color: #fff;
            padding: 12px 20px;
            border-radius: 0 0 24px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .moon-icon {
            background: rgba(255,255,255,0.2);
            width: 36px;
            height: 36px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
        }
        
        .admin-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin: 15px 0;
            padding: 8px;
            background: rgba(30,30,40,0.5);
            border-radius: 20px;
        }
        .admin-btn {
            background: #6b21a5;
            border: none;
            color: #fff;
            padding: 8px 15px;
            border-radius: 30px;
            font-size: 13px;
            cursor: pointer;
            white-space: nowrap;
        }
        .admin-btn.logout { background: #b91c1c; }
        .reviewer-btn { background: #059669; }
        
        .message-bar {
            background: #1e1e2a;
            border-left: 4px solid #a855f7;
            padding: 12px 15px;
            margin: 15px 0;
            border-radius: 8px;
        }
        .message-bar.success { border-color: #10b981; }
        .message-bar.error { border-color: #ef4444; }
        
        .site-title {
            text-align: center;
            margin: 20px 0;
            font-size: 36px;
            font-weight: 800;
            background: linear-gradient(135deg, #facc15, #a855f7);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .main-layout {
            display: grid;
            grid-template-columns: 280px 1fr 280px;
            gap: 20px;
            margin: 20px 0;
        }
        @media (max-width: 1024px) {
            .main-layout { grid-template-columns: 240px 1fr 240px; }
        }
        @media (max-width: 768px) {
            .main-layout {
                grid-template-columns: 1fr;
                position: relative;
            }
            .user-panel, .right-panel {
                display: none;
                position: fixed;
                top: 0;
                bottom: 0;
                width: 85%;
                max-width: 300px;
                background: #1e1e2a;
                z-index: 1001;
                overflow-y: auto;
                transition: transform 0.3s ease;
                box-shadow: 2px 0 10px rgba(0,0,0,0.5);
            }
            .user-panel {
                left: 0;
                transform: translateX(-100%);
            }
            .right-panel {
                right: 0;
                transform: translateX(100%);
            }
            .main-layout.show-left .user-panel {
                transform: translateX(0);
                display: block;
            }
            .main-layout.show-right .right-panel {
                transform: translateX(100%);
                display: block;
            }
            
            .menu-toggle {
                position: fixed;
                top: 15px;
                left: 10px;
                z-index: 1002;
                background: #6b21a5;
                color: white;
                border: none;
                border-radius: 50%;
                width: 48px;
                height: 48px;
                font-size: 24px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            }
            .right-toggle {
                left: auto;
                right: 10px;
            }
            
            .sidebar-overlay {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.5);
                z-index: 1000;
            }
            .main-layout.show-left .sidebar-overlay,
            .main-layout.show-right .sidebar-overlay {
                display: block;
            }
            
            .chat-area {
                margin-top: 0;
                padding-top: 70px;
            }
            
            .tab-bar {
                justify-content: center;
            }
            
            .category-nav {
                justify-content: center;
            }
        }
        
        @media (min-width: 769px) {
            .menu-toggle, .sidebar-overlay {
                display: none;
            }
        }
        
        .user-panel {
            background: rgba(30,30,40,0.8);
            border-radius: 24px;
            padding: 20px;
            border: 1px solid rgba(168,85,247,0.2);
        }
        .user-avatar {
            width: 70px;
            height: 70px;
            border-radius: 50%;
            object-fit: cover;
            border: 3px solid #a855f7;
            margin: 0 auto 10px;
            display: block;
        }
        .user-name {
            font-size: 18px;
            font-weight: 700;
            color: #facc15;
            text-align: center;
        }
        .status {
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            margin-left: 5px;
        }
        .online { background: #10b981; }
        .offline { background: #6b7280; }
        .trusted-badge {
            background: #a855f7;
            color: #fff;
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 10px;
            margin-left: 5px;
        }
        .user-stats {
            background: #1e1e2a;
            border-radius: 16px;
            padding: 12px;
            margin: 12px 0;
            font-size: 13px;
        }
        .stat-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
        }
        .user-btn {
            background: #6b21a5;
            border: none;
            color: #fff;
            padding: 10px;
            border-radius: 30px;
            font-size: 13px;
            cursor: pointer;
            text-align: center;
            display: block;
            margin-bottom: 8px;
            width: 100%;
        }
        .user-btn:hover { background: #7e22ce; }
        .user-btn.sign-btn { background: #10b981; }
        
        .chat-list {
            max-height: 300px;
            overflow-y: auto;
            margin-top: 15px;
        }
        .chat-item {
            display: flex;
            align-items: center;
            padding: 10px;
            background: #1e1e2a;
            border-radius: 12px;
            margin-bottom: 8px;
            cursor: pointer;
            position: relative;
        }
        .chat-item:hover { background: #2a2a3a; }
        .chat-item.active { border-left: 4px solid #facc15; }
        .chat-cover {
            width: 40px;
            height: 40px;
            border-radius: 10px;
            background: #6b21a5;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 10px;
        }
        .chat-info { flex: 1; }
        .chat-name {
            color: #facc15;
            font-weight: 600;
            font-size: 14px;
        }
        .chat-meta { font-size: 11px; color: #9ca3af; }
        .unread-dot {
            position: absolute;
            top: 5px;
            right: 5px;
            width: 8px;
            height: 8px;
            background: #ff4444;
            border-radius: 50%;
            display: none;
        }
        
        .tab-bar {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            border-bottom: 1px solid rgba(168,85,247,0.2);
            padding-bottom: 10px;
            flex-wrap: wrap;
        }
        .tab {
            background: none;
            border: none;
            color: #9ca3af;
            padding: 8px 16px;
            cursor: pointer;
            font-size: 16px;
            text-decoration: none;
        }
        .tab.active {
            color: #facc15;
            border-bottom: 2px solid #facc15;
        }
        
        .category-nav {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin-bottom: 20px;
        }
        .category-btn {
            background: #2a2a3a;
            border: none;
            color: #fff;
            padding: 8px 16px;
            border-radius: 30px;
            font-size: 14px;
            cursor: pointer;
            text-decoration: none;
        }
        .category-btn.active { background: #6b21a5; }
        .post-btn {
            background: #a855f7;
            border: none;
            color: #fff;
            padding: 8px 24px;
            border-radius: 30px;
            font-size: 14px;
            cursor: pointer;
        }
        
        .post-card {
            background: #1e1e2a;
            border-radius: 16px;
            padding: 20px;
            margin-bottom: 15px;
            border: 1px solid rgba(168,85,247,0.1);
        }
        .post-card.sticky { border-left: 4px solid #facc15; }
        .post-card.elite { border-left: 4px solid #10b981; }
        .post-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            flex-wrap: wrap;
        }
        .post-title {
            font-size: 20px;
            font-weight: 600;
            color: #facc15;
            text-decoration: none;
        }
        .post-meta { color: #9ca3af; font-size: 13px; }
        .post-tags { margin: 10px 0; }
        .tag {
            background: rgba(168,85,247,0.1);
            color: #c084fc;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
            margin-right: 5px;
        }
        .post-stats {
            display: flex;
            gap: 15px;
            margin-top: 10px;
            color: #9ca3af;
            font-size: 13px;
            flex-wrap: wrap;
        }
        
        .right-panel {
            background: rgba(30,30,40,0.8);
            border-radius: 24px;
            padding: 20px;
            border: 1px solid rgba(168,85,247,0.2);
        }
        .panel-title {
            color: #c084fc;
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 15px;
            padding-bottom: 8px;
            border-bottom: 2px solid rgba(192,132,252,0.3);
        }
        .member-list { max-height: 300px; overflow-y: auto; }
        .member-item {
            display: flex;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            cursor: pointer;
        }
        .member-avatar {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            margin-right: 10px;
            background: #6b21a5;
        }
        .member-name {
            color: #facc15;
            font-size: 13px;
        }
        .badge {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 10px;
            margin-left: 5px;
        }
        .badge-owner { background: #facc15; color: #000; }
        .badge-admin { background: #a855f7; }
        .badge-muted { background: #ef4444; }
        
        .friend-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .friend-name {
            color: #facc15;
            font-size: 13px;
        }
        .friend-actions { display: flex; gap: 8px; }
        .friend-action {
            color: #9ca3af;
            font-size: 12px;
            cursor: pointer;
        }
        
        .ad-carousel {
            display: flex;
            gap: 10px;
            overflow-x: auto;
            padding: 10px 0;
            margin: 20px 0;
        }
        .ad-item {
            flex: 0 0 200px;
            background: rgba(30,30,40,0.8);
            border-radius: 16px;
            padding: 10px;
            border: 1px solid rgba(168,85,247,0.3);
        }
        .ad-item img {
            width: 100%;
            height: 100px;
            object-fit: cover;
            border-radius: 8px;
        }
        .sidebar-ad {
            background: #1e1e2a;
            border-radius: 16px;
            padding: 15px;
            margin-top: 20px;
            text-align: center;
        }
        
        .news-item {
            padding: 10px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .news-title {
            color: #facc15;
            font-weight: 600;
        }
        .news-meta { font-size: 11px; color: #9ca3af; }
        
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            backdrop-filter: blur(5px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2000;
            visibility: hidden;
            opacity: 0;
            transition: 0.3s;
        }
        .modal-content {
            background: #1e1e2a;
            border-radius: 24px;
            padding: 25px;
            width: 90%;
            max-width: 500px;
            border: 1px solid rgba(168,85,247,0.3);
            max-height: 80vh;
            overflow-y: auto;
        }
        .modal-content h3 {
            color: #c084fc;
            margin-bottom: 15px;
        }
        .modal-content input,
        .modal-content select,
        .modal-content textarea {
            width: 100%;
            padding: 10px;
            margin: 8px 0;
            background: #2a2a3a;
            border: 1px solid #3a3a4a;
            border-radius: 12px;
            color: #fff;
        }
        .modal-actions {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-top: 15px;
            flex-wrap: wrap;
        }
        .btn-primary {
            background: #a855f7;
            color: #fff;
            border: none;
            padding: 10px 20px;
            border-radius: 30px;
            cursor: pointer;
        }
        .btn-secondary {
            background: #3a3a4a;
            color: #fff;
            border: none;
            padding: 10px 20px;
            border-radius: 30px;
            cursor: pointer;
        }
        .btn-danger { background: #ef4444; }
        
        .music-fab {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: linear-gradient(145deg, #6b21a5, #2563eb);
            border: none;
            color: #fff;
            font-size: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 1000;
        }
        .sound-toggle {
            position: fixed;
            bottom: 20px;
            left: 20px;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: #2a2a3a;
            border: 1px solid #6b21a5;
            color: #fff;
            font-size: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 1000;
        }
        
        .login-buttons {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 20px;
        }
        .login-btn {
            background: #6b21a5;
            border: none;
            color: #fff;
            padding: 12px;
            border-radius: 30px;
            font-size: 14px;
            cursor: pointer;
            width: 100%;
        }
        .login-btn.admin { background: #b91c1c; }
        .login-btn.reviewer { background: #059669; }
        
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #1e1e2a; }
        ::-webkit-scrollbar-thumb { background: #6b21a5; border-radius: 3px; }
        
        .user-item, .room-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px;
            background: #1e1e2a;
            border-radius: 8px;
            margin-bottom: 8px;
        }
        .user-item-actions { display: flex; gap: 5px; flex-wrap: wrap; }
        .config-item { margin-bottom: 15px; }
        .config-item label {
            display: block;
            color: #c084fc;
            margin-bottom: 5px;
        }
        
        .danmaku-scroll {
            pointer-events: none;
            opacity: 0.9;
            transition: opacity 0.3s;
            will-change: transform;
        }
        .danmaku-scroll:hover { opacity: 1; }
        .danmaku-item {
            user-select: none;
            -webkit-user-select: none;
            -moz-user-select: none;
            -ms-user-select: none;
        }
        
        .chat-messages {
            height: 400px;
            overflow-y: auto;
            background: #1a1a24;
            border-radius: 12px;
            padding: 15px;
            margin-bottom: 15px;
        }
        .message {
            margin-bottom: 10px;
            padding: 8px 12px;
            background: #2a2a3a;
            border-radius: 12px;
            max-width: 80%;
        }
        .message.own {
            background: #6b21a5;
            margin-left: auto;
        }
        .message-header {
            display: flex;
            gap: 10px;
            font-size: 12px;
            color: #9ca3af;
            margin-bottom: 4px;
        }
        .message-user {
            color: #facc15;
            cursor: pointer;
        }
        .message-content {
            word-break: break-word;
        }
        .message-footer {
            display: flex;
            gap: 10px;
            font-size: 11px;
            color: #9ca3af;
            margin-top: 4px;
        }
        .message-footer span {
            cursor: pointer;
        }
        .chat-input-area {
            display: flex;
            gap: 10px;
        }
        .chat-input {
            flex: 1;
            padding: 10px;
            background: #2a2a3a;
            border: 1px solid #3a3a4a;
            border-radius: 30px;
            color: #fff;
        }
        .chat-send {
            background: #6b21a5;
            border: none;
            color: #fff;
            padding: 10px 20px;
            border-radius: 30px;
            cursor: pointer;
        }

        /* 开关样式 */
        .switch {
          position: relative;
          display: inline-block;
          width: 40px;
          height: 20px;
          margin-left: 5px;
        }
        .switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #ccc;
          transition: .2s;
          border-radius: 20px;
        }
        .slider:before {
          position: absolute;
          content: "";
          height: 16px;
          width: 16px;
          left: 2px;
          bottom: 2px;
          background-color: white;
          transition: .2s;
          border-radius: 50%;
        }
        input:checked + .slider {
          background-color: #10b981;
        }
        input:checked + .slider:before {
          transform: translateX(20px);
        }
    </style>
</head>
<body>
<div class="container">
    <?php if ($CONFIG->showNotice): ?>
    <div class="notice-bar">
        <div>📢 <?php echo h($CONFIG->noticeText); ?></div>
        <div class="moon-icon" id="darkModeToggle">🌙</div>
    </div>
    <?php endif; ?>
    
    <?php if ($message !== ''): ?>
    <div class="message-bar <?php echo $messageType; ?>"><?php echo h($message); ?></div>
    <?php endif; ?>
    
    <?php if (isAdmin() || isReviewer()): ?>
    <div class="admin-bar">
        <?php if (isAdmin()): ?>
        <button class="admin-btn" onclick="showModal('adminUsersModal')">👥 用户管理</button>
        <button class="admin-btn" onclick="showModal('adminRoomsModal')">💬 聊天室管理</button>
        <button class="admin-btn" onclick="showModal('adminPostsModal')">📝 帖子管理</button>
        <button class="admin-btn" onclick="showModal('adminAdsModal')">📢 广告审核</button>
        <button class="admin-btn" onclick="showModal('adminCourtModal')">⚖️ 法庭裁决</button>
        <button class="admin-btn" onclick="showModal('adminAppealsModal')">📋 申诉处理</button>
        <button class="admin-btn" onclick="showModal('adminNewsModal')">📰 新闻管理</button>
        <button class="admin-btn" onclick="showModal('adminLogsModal')">📋 操作日志</button>
        <button class="admin-btn" onclick="showModal('adminConfigModal')">⚙️ 系统设置</button>
        <?php endif; ?>
        <?php if (isReviewer()): ?>
        <button class="admin-btn reviewer-btn" onclick="showModal('reviewerPostsModal')">📝 待审帖子</button>
        <button class="admin-btn reviewer-btn" onclick="showModal('reviewerAdsModal')">📢 待审广告</button>
        <?php endif; ?>
        <form method="post" style="display: inline;">
            <input type="hidden" name="action" value="logout">
            <button class="admin-btn logout">🚪 退出</button>
        </form>
    </div>
    <?php endif; ?>
    
    <h1 class="site-title"><?php echo h($CONFIG->siteTitle); ?></h1>
    
    <?php if (!empty($topAds)): ?>
    <div class="ad-carousel">
        <?php foreach ($topAds as $ad): ?>
        <?php if (is_array($ad)): ?>
        <div class="ad-item">
            <?php if (!empty($ad['image'])): ?><img src="<?php echo h($ad['image']); ?>"><?php endif; ?>
            <a href="<?php echo h($ad['link']); ?>" target="_blank"><?php echo h($ad['title']); ?></a>
        </div>
        <?php endif; ?>
        <?php endforeach; ?>
    </div>
    <?php endif; ?>
    
    <div class="tab-bar">
        <a href="?tab=forum" class="tab <?php echo $tab === 'forum' ? 'active' : ''; ?>">📝 论坛</a>
        <a href="?tab=chat" class="tab <?php echo $tab === 'chat' ? 'active' : ''; ?>">💬 聊天</a>
        <a href="?tab=court" class="tab <?php echo $tab === 'court' ? 'active' : ''; ?>">⚖️ 公开法庭</a>
        <?php if ($currentUser !== null): ?>
        <a href="?tab=profile" class="tab <?php echo $tab === 'profile' ? 'active' : ''; ?>">👤 个人中心</a>
        <?php endif; ?>
    </div>
    
    <!-- 手机版菜单按钮 -->
    <button class="menu-toggle" id="toggleLeftMenu">☰</button>
    <button class="menu-toggle right-toggle" id="toggleRightMenu">⋯</button>
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
    
    <div class="main-layout">
        <!-- 左侧用户面板 -->
        <div class="user-panel">
            <?php if ($currentUser !== null): ?>
                <?php
                $avatarPath = UPLOAD_DIR . 'avatars/' . ($currentUser['avatar'] ?? '');
                $avatarSrc = (!empty($currentUser['avatar']) && file_exists($avatarPath))
                    ? $avatarPath
                    : 'https://via.placeholder.com/70';
                ?>
                <img src="<?php echo $avatarSrc; ?>" class="user-avatar">
                <div class="user-name">
                    <?php echo h($currentUser['nickname'] ?? $_SESSION['user']); ?>
                    <?php if (isTrusted($currentUser)): ?><span class="trusted-badge">✓信任</span><?php endif; ?>
                </div>
                <div class="user-stats">
                    <div class="stat-row">
                        <span>等级</span>
                        <span>
                            Lv.<?php echo (int)($currentUser['level'] ?? 1); ?> 
                            <?php 
                            $displayTitle = $userTitle !== '' ? $userTitle : getTitle((int)($currentUser['level'] ?? 1));
                            echo h($displayTitle);
                            ?>
                        </span>
                    </div>
                    <div class="stat-row">
                        <span><?php echo $CONFIG->coinSign; ?> <?php echo $CONFIG->coinName; ?></span>
                        <span><?php echo (int)($currentUser['coin'] ?? 0); ?></span>
                    </div>
                    <div class="stat-row">
                        <span>信誉分</span>
                        <span>
                            <?php echo (int)($currentUser['reputation'] ?? 50); ?> 
                            <span class="badge">
                                <?php echo getReputationTitle((int)($currentUser['reputation'] ?? 50)); ?>
                            </span>
                        </span>
                    </div>
                    <div class="stat-row">
                        <span>今日投票</span>
                        <span><?php echo (int)($currentUser['votes_today'] ?? 0); ?>次</span>
                    </div>
                    <?php if (isAdmin() && !empty($currentUser['latitude']) && !empty($currentUser['longitude']) && ($currentUser['location_sharing'] ?? 0)): ?>
                    <div class="stat-row">
                        <span>📍 位置</span>
                        <span>
                            <a href="https://www.google.com/maps?q=<?php echo $currentUser['latitude']; ?>,<?php echo $currentUser['longitude']; ?>" target="_blank">查看地图</a>
                        </span>
                    </div>
                    <?php endif; ?>
                </div>
                <form method="post">
                    <input type="hidden" name="action" value="sign">
                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                    <button class="user-btn sign-btn">✅ 每日签到</button>
                </form>
                <button class="user-btn" onclick="showModal('createPostModal')">📝 发帖</button>
                <button class="user-btn" onclick="showModal('createChatModal')">➕ 创建聊天室</button>
                <button class="user-btn" onclick="showModal('friendsModal')">👥 好友</button>
                <button class="user-btn" onclick="showModal('blocksModal')">🚫 黑名单</button>
                <?php if ($tab === 'profile'): ?>
                <button class="user-btn" onclick="showModal('titleModal')">🎖️ 称号中心</button>
                <button class="user-btn" onclick="showModal('changePasswordModal')">🔑 修改密码</button>
                <?php endif; ?>
                
                <!-- 普通用户退出按钮 -->
                <form method="post">
                    <input type="hidden" name="action" value="logout">
                    <button class="user-btn" style="background: #b91c1c;">🚪 退出登录</button>
                </form>
                
                <div style="margin-top: 15px;">
                    <h4 style="color: #c084fc; margin-bottom: 10px;">💬 我的聊天室</h4>
                    <div class="chat-list">
                        <?php foreach ($chats as $id => $room): ?>
                            <?php if (isset($room['members'][$_SESSION['user']]) && is_array($room)): ?>
                            <div class="chat-item <?php echo ($room_id === $id && $private_with === '') ? 'active' : ''; ?>" 
                                 onclick="location.href='?tab=chat&room=<?php echo urlencode($id); ?>'">
                                <div class="chat-cover">💬</div>
                                <div class="chat-info">
                                    <div class="chat-name"><?php echo h($room['name'] ?? '未知'); ?></div>
                                    <div class="chat-meta">👥 <?php echo count($room['members'] ?? []); ?>人</div>
                                </div>
                                <span class="unread-dot" style="display:none;"></span>
                            </div>
                            <?php endif; ?>
                        <?php endforeach; ?>
                    </div>
                </div>
                
                <div style="margin-top: 15px;">
                    <h4 style="color: #c084fc; margin-bottom: 10px;">💌 最近私聊</h4>
                    <div class="chat-list">
                        <?php foreach ($private_list as $contact): ?>
                        <div class="chat-item" data-private="<?php echo $contact; ?>" onclick="location.href='?tab=chat&private=<?php echo urlencode($contact); ?>'">
                            <div class="chat-cover">👤</div>
                            <div class="chat-info">
                                <div class="chat-name"><?php echo h($contact); ?></div>
                                <div class="chat-meta"><?php echo isOnline($contact) ? '在线' : '离线'; ?></div>
                            </div>
                            <span class="unread-dot" style="display:none;"></span>
                        </div>
                        <?php endforeach; ?>
                    </div>
                </div>
            <?php else: ?>
                <div style="text-align: center; padding: 20px;">
                    <div style="font-size: 40px; margin-bottom: 15px;">👋</div>
                    <div class="login-buttons">
                        <button class="login-btn" onclick="showModal('loginModal')">👤 登录</button>
                        <button class="login-btn" onclick="showModal('registerModal')">📝 注册</button>
                        <button class="login-btn admin" onclick="showModal('adminLoginModal')">🔐 管理员</button>
                        <button class="login-btn reviewer" onclick="showModal('reviewerLoginModal')">👑 审核员</button>
                    </div>
                </div>
            <?php endif; ?>
        </div>

        <!-- 中间内容区 -->
        <div class="chat-area">
            <?php if ($tab === 'forum'): ?>
                <?php if ($post_id !== ''): ?>
                    <?php if ($currentPost !== null): ?>
                        <?php $post = $currentPost; ?>
                        <div class="post-card <?php echo !empty($post['sticky']) ? 'sticky' : ''; ?> <?php echo !empty($post['elite']) ? 'elite' : ''; ?>">
                            <div class="post-header">
                                <div class="post-title">
                                    <?php echo h($post['title']); ?>
                                    <?php 
                                    $postPrice = getPostPrice($post['id']);
                                    if ($postPrice > 0): 
                                        if (hasUserPaid($post['id'], $_SESSION['user'] ?? '')): ?>
                                            <span style="background: #10b981; color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 12px; margin-left: 10px;">已购买</span>
                                        <?php elseif (($post['author'] ?? '') !== ($_SESSION['user'] ?? '')): ?>
                                            <span style="background: #f59e0b; color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 12px; margin-left: 10px;">💰 <?php echo $postPrice; ?> 币</span>
                                        <?php endif; ?>
                                    <?php endif; ?>
                                </div>
                                <div class="post-meta"><?php echo date('Y-m-d H:i', $post['time']); ?></div>
                            </div>
                            <div class="post-meta">
                                作者：<?php echo h($post['nickname']); ?> Lv.<?php echo $users[$post['author']]['level'] ?? 1; ?>
                                <?php 
                                $authorTrusted = isset($users[$post['author']]) && isTrusted($users[$post['author']]);
                                if ($authorTrusted): ?>
                                    <span class="trusted-badge">✓信任</span>
                                <?php endif; ?>
                            </div>
                            <?php if (!empty($post['tags'])): ?>
                            <div class="post-tags">
                                <?php $tags = explode(',', $post['tags']); ?>
                                <?php foreach ($tags as $tag): ?>
                                <span class="tag">#<?php echo h(trim($tag)); ?></span>
                                <?php endforeach; ?>
                            </div>
                            <?php endif; ?>
                            
                            <div style="display: flex; gap: 10px; margin: 15px 0; flex-wrap: wrap;">
                                <?php if ($currentUser !== null && ($post['author'] ?? '') !== $_SESSION['user']): ?>
                                <button class="user-btn" style="background: #10b981;" onclick="showDonateModal('<?php echo $post['author']; ?>', '<?php echo $post['id']; ?>', '<?php echo h(addslashes($post['nickname'])); ?>')">💰 打赏作者</button>
                                <?php endif; ?>
                                
                                <?php if ($currentUser !== null && (($post['author'] ?? '') === $_SESSION['user'] || isAdmin())): ?>
                                <button class="user-btn" style="background: #f59e0b;" onclick="showSetPriceModal('<?php echo $post['id']; ?>', <?php echo getPostPrice($post['id']); ?>)">💲 设置付费</button>
                                <?php endif; ?>
                                
                                <?php if ($currentUser !== null): ?>
                                <button class="user-btn" style="background: #a855f7;" onclick="showDanmakuModal('<?php echo $post['id']; ?>')">📺 发弹幕</button>
                                <?php endif; ?>
                            </div>
                            
                            <?php 
                            $postPrice = getPostPrice($post['id']);
                            $canViewContent = true;
                            if ($postPrice > 0) {
                                if (($post['author'] ?? '') === ($_SESSION['user'] ?? '') || isAdmin()) {
                                    $canViewContent = true;
                                } else {
                                    $canViewContent = hasUserPaid($post['id'], $_SESSION['user'] ?? '');
                                }
                            }
                            ?>
                            
                            <?php if ($canViewContent): ?>
                                <div style="margin: 20px 0;"><?php echo nl2br(h($post['content'])); ?></div>
                            <?php else: ?>
                                <div style="margin: 20px 0; padding: 30px; background: #2a2a3a; border-radius: 12px; text-align: center;">
                                    <div style="font-size: 40px; margin-bottom: 15px;">💰</div>
                                    <h3 style="color: #facc15; margin-bottom: 10px;">付费内容</h3>
                                    <p style="color: #9ca3af; margin-bottom: 20px;">本帖需要支付 <?php echo $postPrice; ?> 资本币才能查看完整内容</p>
                                    <form method="post">
                                        <input type="hidden" name="action" value="buy_post">
                                        <input type="hidden" name="post_id" value="<?php echo $post['id']; ?>">
                                        <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                                        <button type="submit" class="user-btn" style="background: #f59e0b; display: inline-block; width: auto; padding: 10px 30px;">立即购买</button>
                                    </form>
                                </div>
                            <?php endif; ?>
                            
                            <div class="post-stats">
                                <span>👁️ <?php echo $post['views'] ?? 0; ?></span>
                                <span><a href="#" onclick="likePost('<?php echo $post['id']; ?>'); return false;">👍 <?php echo count($post['likes'] ?? []); ?></a></span>
                                <span><a href="#" onclick="dislikePost('<?php echo $post['id']; ?>'); return false;">👎 <?php echo count($post['dislikes'] ?? []); ?></a></span>
                                <span>💬 <?php echo count($comments); ?></span>
                                <?php if (isAdmin() || isReviewer()): ?>
                                <form method="post" style="display: inline;">
                                    <input type="hidden" name="action" value="sticky_post">
                                    <input type="hidden" name="post_id" value="<?php echo $post['id']; ?>">
                                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                                    <button type="submit" style="background: none; border: none; color: #9ca3af; cursor: pointer;">📌 <?php echo empty($post['sticky']) ? '置顶' : '取消置顶'; ?></button>
                                </form>
                                <form method="post" style="display: inline;">
                                    <input type="hidden" name="action" value="elite_post">
                                    <input type="hidden" name="post_id" value="<?php echo $post['id']; ?>">
                                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                                    <button type="submit" style="background: none; border: none; color: #9ca3af; cursor: pointer;">⭐ <?php echo empty($post['elite']) ? '精华' : '取消精华'; ?></button>
                                </form>
                                <form method="post" style="display: inline;" onsubmit="return confirm('确定删除？');">
                                    <input type="hidden" name="action" value="delete_post_admin">
                                    <input type="hidden" name="post_id" value="<?php echo $post['id']; ?>">
                                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                                    <button type="submit" style="background: none; border: none; color: #ef4444; cursor: pointer;">🗑️ 删除</button>
                                </form>
                                <?php endif; ?>
                            </div>
                        </div>
                        
                        <!-- 弹幕显示区域 -->
                        <?php if ($post_id !== '' && $currentUser !== null): ?>
                        <div style="background: #1a1a24; border-radius: 12px; padding: 15px; margin: 20px 0;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                <h3 style="color: #c084fc;">📺 弹幕区</h3>
                                <span style="color: #9ca3af; font-size: 12px;" id="danmakuCount">0 条弹幕</span>
                            </div>
                            <div id="danmakuContainer" style="position: relative; height: 200px; background: #0a0a0f; border-radius: 8px; overflow: hidden; border: 1px solid #3a3a4a;"></div>
                        </div>
                        <?php endif; ?>
                        
                        <div style="margin-top: 30px;">
                            <h3 style="color: #c084fc; margin-bottom: 20px;">评论 (<?php echo count($comments); ?>)</h3>
                            
                            <?php if ($currentUser !== null): ?>
                            <form method="post" style="margin-bottom: 30px;">
                                <input type="hidden" name="action" value="new_comment">
                                <input type="hidden" name="post_id" value="<?php echo $post['id']; ?>">
                                <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                                <textarea name="content" style="width: 100%; min-height: 80px; padding: 10px; background: #2a2a3a; border: 1px solid #3a3a4a; border-radius: 12px; color: #fff;" placeholder="写下你的评论..." required></textarea>
                                <button type="submit" class="user-btn" style="margin-top: 10px;">发表评论</button>
                            </form>
                            <?php endif; ?>
                            
                            <?php foreach ($comments as $comment): ?>
                            <?php if (is_array($comment)): ?>
                            <div style="background: #1a1a24; border-radius: 12px; padding: 15px; margin-bottom: 15px;">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                                    <span style="color: #facc15;"><?php echo h($comment['nickname']); ?></span>
                                    <span style="color: #9ca3af; font-size: 12px;"><?php echo date('Y-m-d H:i', $comment['time']); ?></span>
                                </div>
                                <div><?php echo nl2br(h($comment['content'])); ?></div>
                                <?php if (isAdmin() || isReviewer()): ?>
                                <form method="post" style="margin-top: 10px;">
                                    <input type="hidden" name="action" value="delete_comment_admin">
                                    <input type="hidden" name="comment_id" value="<?php echo $comment['id']; ?>">
                                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                                    <button type="submit" style="background: none; border: none; color: #ef4444; cursor: pointer;">🗑️ 删除</button>
                                </form>
                                <?php endif; ?>
                            </div>
                            <?php endif; ?>
                            <?php endforeach; ?>
                        </div>
                        
                        <a href="?tab=forum" class="user-btn" style="display: inline-block; margin-top: 20px;">← 返回论坛</a>
                    <?php endif; ?>
                    
                <?php else: ?>
                    <div class="category-nav">
                        <a href="?tab=forum" class="category-btn <?php echo $category === '' ? 'active' : ''; ?>">全部</a>
                        <?php foreach ($CONFIG->categories as $cat): ?>
                        <a href="?tab=forum&category=<?php echo urlencode($cat); ?>" class="category-btn <?php echo $category === $cat ? 'active' : ''; ?>"><?php echo h($cat); ?></a>
                        <?php endforeach; ?>
                        <?php if ($currentUser !== null): ?>
                        <button class="post-btn" onclick="showModal('createPostModal')">+ 发帖</button>
                        <?php endif; ?>
                    </div>
                    
                    <?php if (empty($posts)): ?>
                    <div style="text-align: center; padding: 50px; color: #9ca3af;">暂无帖子，快来发布第一个吧！</div>
                    <?php else: ?>
                    <?php foreach ($posts as $post): ?>
                    <?php if (is_array($post)): ?>
                    <div class="post-card <?php echo !empty($post['sticky']) ? 'sticky' : ''; ?> <?php echo !empty($post['elite']) ? 'elite' : ''; ?>">
                        <div class="post-header">
                            <a href="?tab=forum&post=<?php echo $post['id']; ?>" class="post-title">
                                <?php echo h($post['title']); ?>
                                <?php 
                                $postPrice = getPostPrice($post['id']);
                                if ($postPrice > 0): ?>
                                    <span style="background: #f59e0b; color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 12px; margin-left: 10px;">💰 <?php echo $postPrice; ?> 币</span>
                                <?php endif; ?>
                            </a>
                            <div class="post-meta"><?php echo date('Y-m-d H:i', $post['time']); ?></div>
                        </div>
                        <div class="post-meta">
                            作者：<?php echo h($post['nickname']); ?> · 分类：<?php echo h($post['category']); ?>
                            <?php 
                            $authorTrusted = isset($users[$post['author']]) && isTrusted($users[$post['author']]);
                            if ($authorTrusted): ?>
                                <span class="trusted-badge">✓信任</span>
                            <?php endif; ?>
                        </div>
                        <?php if (!empty($post['tags'])): ?>
                        <div class="post-tags">
                            <?php $tags = explode(',', $post['tags']); ?>
                            <?php foreach ($tags as $tag): ?>
                            <span class="tag">#<?php echo h(trim($tag)); ?></span>
                            <?php endforeach; ?>
                        </div>
                        <?php endif; ?>
                        <div class="post-stats">
                            <span>👁️ <?php echo $post['views'] ?? 0; ?></span>
                            <span>👍 <?php echo count($post['likes'] ?? []); ?></span>
                            <span>💬 <?php echo $comment_counts[$post['id']] ?? 0; ?></span>
                            <?php if (!empty($post['sticky'])): ?><span>📌 置顶</span><?php endif; ?>
                            <?php if (!empty($post['elite'])): ?><span>⭐ 精华</span><?php endif; ?>
                        </div>
                        
                        <?php if (isAdmin() || isReviewer()): ?>
                        <div style="margin-top: 8px; display: flex; gap: 10px; border-top: 1px solid #2a2a3a; padding-top: 8px;">
                            <form method="post" style="display:inline;">
                                <input type="hidden" name="action" value="sticky_post">
                                <input type="hidden" name="post_id" value="<?php echo $post['id']; ?>">
                                <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                                <button type="submit" class="friend-action">📌 <?php echo empty($post['sticky']) ? '置顶' : '取消置顶'; ?></button>
                            </form>
                            <form method="post" style="display:inline;">
                                <input type="hidden" name="action" value="elite_post">
                                <input type="hidden" name="post_id" value="<?php echo $post['id']; ?>">
                                <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                                <button type="submit" class="friend-action">⭐ <?php echo empty($post['elite']) ? '精华' : '取消精华'; ?></button>
                            </form>
                            <form method="post" style="display:inline;" onsubmit="return confirm('确定删除？');">
                                <input type="hidden" name="action" value="delete_post_admin">
                                <input type="hidden" name="post_id" value="<?php echo $post['id']; ?>">
                                <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                                <button type="submit" class="friend-action" style="color:#ef4444;">🗑️ 删除</button>
                            </form>
                        </div>
                        <?php endif; ?>
                    </div>
                    <?php endif; ?>
                    <?php endforeach; ?>
                    
                    <?php if ($totalPages > 1): ?>
                    <div style="display: flex; justify-content: center; gap: 10px; margin: 20px 0;">
                        <?php for ($i = 1; $i <= $totalPages; $i++): ?>
                        <a href="?tab=forum&category=<?php echo urlencode($category); ?>&page=<?php echo $i; ?>" class="category-btn <?php echo $i === $page ? 'active' : ''; ?>"><?php echo $i; ?></a>
                        <?php endfor; ?>
                    </div>
                    <?php endif; ?>
                    <?php endif; ?>
                <?php endif; ?>
                
            <?php elseif ($tab === 'chat'): ?>
                <?php if ($private_with !== ''): ?>
                <div style="margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-size: 18px; color: #facc15;">与 <?php echo h($private_with); ?> 私聊</div>
                    <?php if ($currentUser !== null && $private_with !== $_SESSION['user']): ?>
                    <button class="admin-btn" onclick="showModal('privateModal')">⚙️ 设置</button>
                    <?php endif; ?>
                </div>
                <?php elseif ($currentRoom !== null): ?>
                <div style="margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-size: 18px; color: #facc15;"><?php echo h($currentRoom['name']); ?></div>
                    <?php if ($currentUser !== null && canManage($_SESSION['user'], $currentRoom)): ?>
                    <button class="admin-btn" onclick="showModal('manageRoomModal')">⚙️ 管理</button>
                    <?php endif; ?>
                </div>
                <?php endif; ?>
                
                <div class="chat-messages" id="chatMessages">
                    <?php foreach ($roomMessages as $msg): ?>
                    <?php if (is_array($msg)): ?>
                    <div class="message <?php echo ($msg['u'] ?? '') === $_SESSION['user'] ? 'own' : ''; ?>" data-id="<?php echo $msg['id'] ?? ''; ?>" data-time="<?php echo $msg['t'] ?? 0; ?>">
                        <div class="message-header">
                            <?php if (($msg['u'] ?? '') !== $_SESSION['user']): ?>
                            <span class="message-user" onclick="location.href='?tab=chat&private=<?php echo urlencode($msg['u'] ?? ''); ?>'"><?php echo h($msg['n'] ?? ''); ?></span>
                            <?php endif; ?>
                            <span class="message-time"><?php echo $msg['ts'] ?? ''; ?></span>
                            <?php if (!empty($msg['edited'])): ?>
                            <span class="edited">(已编辑)</span>
                            <?php endif; ?>
                            <?php if (isset($msg['read']) && is_array($msg['read']) && in_array($_SESSION['user'] ?? '', $msg['read'], true)): ?>
                            <span class="read-badge" style="color: #10b981; font-size: 10px;">✓</span>
                            <?php endif; ?>
                        </div>
                        <div class="message-content"><?php echo nl2br(h($msg['m'] ?? '')); ?></div>
                        <?php if ($currentUser !== null && (($msg['u'] ?? '') === $_SESSION['user'] || isAdmin() || isReviewer())): ?>
                        <div class="message-footer">
                            <?php if (($msg['u'] ?? '') === $_SESSION['user'] && (time() - ($msg['t'] ?? 0) < $CONFIG->recallTimeout)): ?>
                            <span onclick="recallMessage('<?php echo $room_id; ?>', '<?php echo $msg['id'] ?? ''; ?>')">↩️ 撤回</span>
                            <?php elseif (isAdmin() || isReviewer()): ?>
                            <span onclick="recallMessage('<?php echo $room_id; ?>', '<?php echo $msg['id'] ?? ''; ?>')">↩️ 撤回</span>
                            <?php endif; ?>
                            <?php if (isAdmin() || isReviewer() || ($msg['u'] ?? '') === $_SESSION['user']): ?>
                            <span onclick="editMessage('<?php echo $room_id; ?>', '<?php echo $msg['id'] ?? ''; ?>', '<?php echo str_replace("'", "\\'", h($msg['m'] ?? '')); ?>')">✏️ 编辑</span>
                            <?php endif; ?>
                            <?php if (!empty($msg['history'])): ?>
                            <span onclick="showHistory('<?php echo $room_id; ?>', '<?php echo $msg['id'] ?? ''; ?>')">📜 历史</span>
                            <?php endif; ?>
                        </div>
                        <?php endif; ?>
                    </div>
                    <?php endif; ?>
                    <?php endforeach; ?>
                </div>
                
                <?php if ($currentUser !== null): ?>
                    <?php if ($private_with !== '' && $private_with !== $_SESSION['user'] && !isBlocked($_SESSION['user'], $private_with)): ?>
                    <div class="chat-input-area">
                        <input type="text" id="msgInput" class="chat-input" placeholder="输入消息..." onkeypress="if (event.keyCode == 13) sendPrivate()">
                        <button class="chat-send" onclick="sendPrivate()">发送</button>
                    </div>
                    <?php elseif ($currentRoom !== null && canSend($_SESSION['user'], $currentRoom)): ?>
                    <div class="chat-input-area">
                        <input type="text" id="msgInput" class="chat-input" placeholder="输入消息..." onkeypress="if (event.keyCode == 13) sendRoom()">
                        <button class="chat-send" onclick="sendRoom()">发送</button>
                    </div>
                    <?php endif; ?>
                <?php endif; ?>
                
            <?php elseif ($tab === 'court'): ?>
                <div style="margin-bottom: 20px;">
                    <h3 style="color: #facc15;">⚖️ 公开法庭</h3>
                    <p style="color: #9ca3af;">每人每天有10票，投票结果决定封禁与否。平局由管理员裁决。</p>
                </div>
                
                <?php if ($currentUser !== null): ?>
                <button class="user-btn" onclick="showModal('reportModal')">📢 我要举报</button>
                <?php endif; ?>
                
                <?php if (empty($reports)): ?>
                <div style="text-align: center; padding: 50px; color: #9ca3af;">暂无待审案件</div>
                <?php else: ?>
                <?php foreach ($reports as $report): ?>
                <?php if (is_array($report)): ?>
                <div class="post-card" style="border-left: 4px solid #f59e0b;">
                    <div class="post-header">
                        <span style="color: #f59e0b;">案件 #<?php echo substr($report['id'] ?? '', -6); ?></span>
                        <span class="post-meta"><?php echo date('Y-m-d H:i', $report['time'] ?? 0); ?></span>
                    </div>
                    <div>被举报人：<span style="color: #facc15;"><?php echo h($report['reported'] ?? ''); ?></span></div>
                    <div>举报人：<?php echo !empty($report['reporter_anonymous']) ? '匿名用户' : h($report['reporter'] ?? ''); ?></div>
                    <div style="margin: 10px 0;">理由：<?php echo nl2br(h($report['reason'] ?? '')); ?></div>
                    <?php if (!empty($report['evidence'])): ?><div style="color: #9ca3af;">证据：<?php echo h($report['evidence']); ?></div><?php endif; ?>
                    <div style="display: flex; gap: 20px; margin: 10px 0;">
                        <div>封禁票：<span style="color: #ef4444;"><?php echo $report['votes_ban'] ?? 0; ?></span></div>
                        <div>不封禁票：<span style="color: #10b981;"><?php echo $report['votes_noban'] ?? 0; ?></span></div>
                        <div>还需：<?php echo max(0, VOTE_BAN_THRESHOLD * 2 - (($report['votes_ban'] ?? 0) + ($report['votes_noban'] ?? 0))); ?>票</div>
                    </div>
                    <?php if ($currentUser !== null && ($currentUser['votes_today'] ?? 0) > 0 && !isset($report['votes'][$_SESSION['user']])): ?>
                    <div style="display: flex; gap: 10px;">
                        <form method="post">
                            <input type="hidden" name="action" value="vote_report">
                            <input type="hidden" name="report_id" value="<?php echo $report['id'] ?? ''; ?>">
                            <input type="hidden" name="vote" value="ban">
                            <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                            <button type="submit" class="user-btn" style="background: #ef4444;">👎 投封禁</button>
                        </form>
                        <form method="post">
                            <input type="hidden" name="action" value="vote_report">
                            <input type="hidden" name="report_id" value="<?php echo $report['id'] ?? ''; ?>">
                            <input type="hidden" name="vote" value="noban">
                            <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                            <button type="submit" class="user-btn" style="background: #10b981;">👍 投不封禁</button>
                        </form>
                    </div>
                    <?php endif; ?>
                </div>
                <?php endif; ?>
                <?php endforeach; ?>
                <?php endif; ?>
                
            <?php elseif ($tab === 'profile' && $currentUser !== null): ?>
                <div style="text-align: center; margin-bottom: 20px;">
                    <?php
                    $avatarPath = UPLOAD_DIR . 'avatars/' . ($currentUser['avatar'] ?? '');
                    $avatarSrc = (!empty($currentUser['avatar']) && file_exists($avatarPath))
                        ? $avatarPath
                        : 'https://via.placeholder.com/100';
                    ?>
                    <img src="<?php echo $avatarSrc; ?>" style="width: 100px; height: 100px; border-radius: 50%; border: 3px solid #a855f7;">
                    <h2 style="color: #facc15;"><?php echo h($currentUser['nickname'] ?? $_SESSION['user']); ?></h2>
                    <p>@<?php echo h($_SESSION['user']); ?> · Lv.<?php echo (int)($currentUser['level'] ?? 1); ?> <?php 
                        $displayTitle = $userTitle !== '' ? $userTitle : getTitle((int)($currentUser['level'] ?? 1));
                        echo h($displayTitle);
                    ?></p>
                    <button class="user-btn" onclick="showModal('profileEditModal')">✏️ 编辑资料</button>
                    <button class="user-btn" onclick="showModal('titleModal')">🎖️ 称号中心</button>
                    <button class="user-btn" onclick="showModal('changePasswordModal')">🔑 修改密码</button>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
                    <div class="stat-row"><span><?php echo $CONFIG->coinSign; ?> <?php echo $CONFIG->coinName; ?></span><span><?php echo (int)($currentUser['coin'] ?? 0); ?></span></div>
                    <div class="stat-row"><span>信誉分</span><span><?php echo (int)($currentUser['reputation'] ?? 50); ?> (<?php echo getReputationTitle((int)($currentUser['reputation'] ?? 50)); ?>)</span></div>
                    <div class="stat-row"><span>连续签到</span><span><?php echo (int)($currentUser['sign_count'] ?? 0); ?>天</span></div>
                    <div class="stat-row"><span>今日投票</span><span><?php echo (int)($currentUser['votes_today'] ?? 0); ?>次</span></div>
                    
                    <!-- 位置共享控制（仅当前用户自己可见） -->
                    <div class="stat-row" style="grid-column: span 2;">
                        <span>📍 位置共享</span>
                        <span>
                            <label class="switch">
                                <input type="checkbox" id="locationSharingToggle" <?php echo ($currentUser['location_sharing'] ?? 0) ? 'checked' : ''; ?>>
                                <span class="slider round"></span>
                            </label>
                        </span>
                    </div>
                    <div class="stat-row" style="grid-column: span 2; font-size: 12px; color: #9ca3af;">
                        <span id="locationStatus"><?php echo ($currentUser['latitude'] && $currentUser['longitude']) ? '位置已获取' : '未获取位置'; ?></span>
                    </div>
                </div>
                
                <?php if (isAdmin()): ?>
                <div style="margin-top: 20px; background: #1e1e2a; border-radius: 12px; padding: 15px;">
                    <h4 style="color: #facc15;">⚙️ 管理员修改自身数据</h4>
                    <form method="post">
                        <input type="number" name="coin" placeholder="资本币" value="<?php echo (int)$currentUser['coin']; ?>" step="1" style="width:100%; margin-bottom:5px;">
                        <input type="number" name="reputation" placeholder="信誉分" value="<?php echo (int)$currentUser['reputation']; ?>" step="1" style="width:100%; margin-bottom:5px;">
                        <input type="number" name="exp" placeholder="经验" value="<?php echo (int)$currentUser['exp']; ?>" step="1" style="width:100%; margin-bottom:5px;">
                        <input type="hidden" name="action" value="admin_edit_user">
                        <input type="hidden" name="target_user" value="<?php echo $_SESSION['user']; ?>">
                        <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                        <button type="submit" class="btn-primary" style="width:100%;">更新我的数据</button>
                    </form>
                </div>
                <?php endif; ?>
                
                <h4 style="color: #c084fc; margin: 20px 0 10px;">我的帖子</h4>
                <?php 
                $allPosts = loadData(POSTS_FILE);
                $myPosts = [];
                if (is_array($allPosts)) {
                    foreach ($allPosts as $p) {
                        if (($p['author'] ?? '') === $_SESSION['user']) {
                            $myPosts[] = $p;
                        }
                    }
                }
                if (empty($myPosts)): ?>
                <p style="color: #9ca3af;">暂无帖子</p>
                <?php else: ?>
                <?php foreach ($myPosts as $post): ?>
                <?php if (is_array($post)): ?>
                <div class="post-card">
                    <a href="?tab=forum&post=<?php echo $post['id']; ?>" class="post-title"><?php echo h($post['title']); ?></a>
                    <?php 
                    $postPrice = getPostPrice($post['id']);
                    if ($postPrice > 0): ?>
                        <span style="background: #f59e0b; color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 12px; margin-left: 10px;">💰 <?php echo $postPrice; ?> 币</span>
                    <?php endif; ?>
                    <div class="post-meta"><?php echo date('Y-m-d H:i', $post['time']); ?> · 👍 <?php echo count($post['likes'] ?? []); ?></div>
                </div>
                <?php endif; ?>
                <?php endforeach; ?>
                <?php endif; ?>
                
                <?php if (isset($currentUser['banned'])): ?>
                <div style="margin-top: 20px;">
                    <button class="user-btn" onclick="showModal('appealModal')">📝 提交申诉</button>
                </div>
                <?php endif; ?>
                
            <?php endif; ?>
        </div>
        
        <!-- 右侧面板 -->
        <div class="right-panel">
            <?php if ($tab === 'forum'): ?>
                <div class="panel-title">🔥 热门帖子</div>
                <?php foreach ($hotPosts as $post): ?>
                <?php if (is_array($post)): ?>
                <div class="hot-post" style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <a href="?tab=forum&post=<?php echo $post['id']; ?>" style="color: #e0e0e0; text-decoration: none;"><?php echo h(mb_substr($post['title'], 0, 20)); ?><?php echo mb_strlen($post['title']) > 20 ? '...' : ''; ?></a>
                    <div style="font-size: 11px; color: #9ca3af;">👁️ <?php echo $post['views'] ?? 0; ?> · 👍 <?php echo count($post['likes'] ?? []); ?></div>
                </div>
                <?php endif; ?>
                <?php endforeach; ?>
                
                <div class="panel-title" style="margin-top: 20px;">🏷️ 标签云</div>
                <div style="display: flex; flex-wrap: wrap; gap: 5px;">
                    <?php
                    $allTags = [];
                    $allPosts = loadData(POSTS_FILE);
                    if (is_array($allPosts)) {
                        foreach ($allPosts as $p) {
                            if (is_array($p) && !empty($p['tags'])) {
                                $tags = explode(',', $p['tags']);
                                foreach ($tags as $tag) {
                                    $tag = trim($tag);
                                    if ($tag !== '') {
                                        $allTags[] = $tag;
                                    }
                                }
                            }
                        }
                    }
                    $tagCounts = array_count_values($allTags);
                    arsort($tagCounts);
                    $tagCounts = array_slice($tagCounts, 0, 15);
                    foreach ($tagCounts as $tag => $cnt): ?>
                    <span class="tag" style="font-size: <?php echo 11 + min($cnt, 5); ?>px;">#<?php echo h($tag); ?></span>
                    <?php endforeach; ?>
                </div>
                
                <?php if ($post_id !== ''): 
                    $donations = loadDonations($post_id);
                    if (!empty($donations)): 
                ?>
                <div class="panel-title" style="margin-top: 20px;">💰 打赏榜</div>
                <?php 
                    $donateStats = [];
                    foreach ($donations as $d) {
                        if (is_array($d)) {
                            $donor = $d['from'] ?? '';
                            if ($donor !== '') {
                                $donateStats[$donor] = ($donateStats[$donor] ?? 0) + ($d['amount'] ?? 0);
                            }
                        }
                    }
                    arsort($donateStats);
                    $topDonors = array_slice($donateStats, 0, 5, true);
                    foreach ($topDonors as $donor => $total): 
                ?>
                <div style="display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <span style="color: #facc15;"><?php echo h($donor); ?></span>
                    <span style="color: #10b981;">💰 <?php echo $total; ?></span>
                </div>
                <?php endforeach; ?>
                <?php endif; endif; ?>
                
                <?php if ($sidebarAd !== null && is_array($sidebarAd)): ?>
                <div class="sidebar-ad">
                    <?php if (!empty($sidebarAd['image'])): ?>
                    <img src="<?php echo h($sidebarAd['image']); ?>" style="width: 100%; border-radius: 8px; margin-bottom: 10px;">
                    <?php endif; ?>
                    <a href="<?php echo h($sidebarAd['link']); ?>" target="_blank"><?php echo h($sidebarAd['title']); ?></a>
                </div>
                <?php endif; ?>
                
                <div class="panel-title" style="margin-top: 20px;">📰 最新新闻</div>
                <?php if (empty($newsList)): ?>
                <p style="color: #9ca3af;">暂无新闻</p>
                <?php else: ?>
                <?php foreach ($newsList as $news): ?>
                <?php if (is_array($news)): ?>
                <div class="news-item">
                    <a href="<?php echo h($news['link']); ?>" target="_blank" class="news-title"><?php echo h($news['title']); ?></a>
                    <div class="news-meta"><?php echo date('Y-m-d', $news['time']); ?></div>
                    <?php if (!empty($news['content'])): ?>
                    <div style="font-size: 12px; color: #aaa;"><?php echo h(mb_substr($news['content'], 0, 50)); ?><?php echo mb_strlen($news['content']) > 50 ? '...' : ''; ?></div>
                    <?php endif; ?>
                </div>
                <?php endif; ?>
                <?php endforeach; ?>
                <?php endif; ?>
                
            <?php elseif ($tab === 'chat'): ?>
                <?php if ($private_with !== '' && $currentUser !== null): ?>
                    <div class="panel-title">👤 <?php echo h($private_with); ?></div>
                    <div style="margin-bottom: 15px;">
                        <span class="status <?php echo isOnline($private_with) ? 'online' : 'offline'; ?>"></span> <?php echo isOnline($private_with) ? '在线' : '离线'; ?>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <button class="user-btn" onclick="addFriend('<?php echo $private_with; ?>')">➕ 加好友</button>
                        <button class="user-btn" onclick="blockUser('<?php echo $private_with; ?>')">🚫 拉黑</button>
                        <button class="user-btn" onclick="clearPrivate('<?php echo $private_with; ?>')">🗑️ 清空记录</button>
                    </div>
                <?php elseif ($currentRoom !== null && is_array($currentRoom)): ?>
                    <div class="panel-title">👥 成员列表 (<?php echo count($currentRoom['members'] ?? []); ?>)</div>
                    <div class="member-list">
                        <?php foreach (($currentRoom['members'] ?? []) as $member => $info): ?>
                        <?php if (is_array($info)): ?>
                        <div class="member-item" onclick="location.href='?tab=chat&private=<?php echo urlencode($member); ?>'">
                            <div class="member-avatar"></div>
                            <div class="member-name">
                                <?php echo h($users[$member]['nickname'] ?? $member); ?>
                                <?php if ($member === ($currentRoom['owner'] ?? '')): ?><span class="badge badge-owner">室主</span><?php endif; ?>
                                <?php if (in_array($member, $currentRoom['admins'] ?? [], true)): ?><span class="badge badge-admin">管理</span><?php endif; ?>
                                <?php if (!empty($info['muted'])): ?><span class="badge badge-muted">禁言</span><?php endif; ?>
                            </div>
                        </div>
                        <?php endif; ?>
                        <?php endforeach; ?>
                    </div>
                <?php endif; ?>
                
            <?php elseif ($tab === 'court'): ?>
                <div class="panel-title">⚖️ 投票规则</div>
                <ul style="color: #9ca3af; font-size: 13px; padding-left: 20px;">
                    <li>每人每天10票</li>
                    <li>封禁需≥<?php echo VOTE_BAN_THRESHOLD; ?>票</li>
                    <li>平局由管理员裁决</li>
                </ul>
                
                <?php if ($currentUser !== null && !empty($myReports)): ?>
                <div class="panel-title" style="margin-top: 20px;">📋 我的案件</div>
                <?php foreach ($myReports as $r): ?>
                <?php if (is_array($r)): ?>
                <div style="font-size: 12px; margin-bottom: 8px;">
                    <span style="color: <?php echo ($r['status'] ?? '') === 'pending' ? '#f59e0b' : '#9ca3af'; ?>;"><?php echo ($r['status'] ?? '') === 'pending' ? '待审' : '已决'; ?></span>
                    <?php echo h($r['reported'] ?? ''); ?>
                </div>
                <?php endif; ?>
                <?php endforeach; ?>
                <?php endif; ?>
                
            <?php elseif ($tab === 'profile' && $currentUser !== null): ?>
                <div class="panel-title">👥 我的好友</div>
                <?php 
                $friends_list = $friends[$_SESSION['user']] ?? [];
                if (empty($friends_list)): ?>
                <p style="color: #9ca3af;">暂无好友</p>
                <?php else: ?>
                <?php foreach ($friends_list as $f): ?>
                <div class="friend-item">
                    <span class="friend-name"><?php echo h($f); ?></span>
                    <span class="friend-actions">
                        <a href="?tab=chat&private=<?php echo urlencode($f); ?>" class="friend-action">💬</a>
                    </span>
                </div>
                <?php endforeach; ?>
                <?php endif; ?>
                
                <div class="panel-title" style="margin-top: 20px;">🚫 黑名单</div>
                <?php 
                $blocks_list = $blocks[$_SESSION['user']] ?? [];
                if (empty($blocks_list)): ?>
                <p style="color: #9ca3af;">暂无黑名单</p>
                <?php else: ?>
                <?php foreach ($blocks_list as $b => $t): ?>
                <div class="friend-item">
                    <span class="friend-name" style="color: #ef4444;"><?php echo h($b); ?></span>
                    <span class="friend-action" onclick="unblockUser('<?php echo $b; ?>')">解除</span>
                </div>
                <?php endforeach; ?>
                <?php endif; ?>
                
            <?php endif; ?>
        </div>
    </div>
</div>

<!-- ==================== 所有弹窗 ==================== -->

<!-- 登录弹窗 -->
<div id="loginModal" class="modal-overlay">
    <div class="modal-content">
        <h3>🔐 用户登录</h3>
        <form method="post">
            <input type="text" name="username" placeholder="用户名" required>
            <input type="password" name="password" placeholder="密码" required>
            <input type="hidden" name="action" value="login">
            <?php if ($login_error !== ''): ?><p style="color: #f87171;"><?php echo h($login_error); ?></p><?php endif; ?>
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="hideModal('loginModal')">取消</button>
                <button type="submit" class="btn-primary">登录</button>
            </div>
        </form>
    </div>
</div>

<!-- 管理员登录弹窗 -->
<div id="adminLoginModal" class="modal-overlay">
    <div class="modal-content">
        <h3>🔐 管理员登录</h3>
        <form method="post">
            <input type="password" name="password" placeholder="管理员密码" required>
            <input type="hidden" name="action" value="admin_login">
            <?php if ($login_error !== ''): ?><p style="color: #f87171;"><?php echo h($login_error); ?></p><?php endif; ?>
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="hideModal('adminLoginModal')">取消</button>
                <button type="submit" class="btn-primary">登录</button>
            </div>
        </form>
    </div>
</div>

<!-- 审核员登录弹窗 -->
<div id="reviewerLoginModal" class="modal-overlay">
    <div class="modal-content">
        <h3>👑 审核员登录</h3>
        <form method="post">
            <input type="password" name="password" placeholder="审核员密码" required>
            <input type="hidden" name="action" value="reviewer_login">
            <?php if ($login_error !== ''): ?><p style="color: #f87171;"><?php echo h($login_error); ?></p><?php endif; ?>
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="hideModal('reviewerLoginModal')">取消</button>
                <button type="submit" class="btn-primary" style="background: #059669;">登录</button>
            </div>
        </form>
    </div>
</div>

<!-- 注册弹窗 -->
<div id="registerModal" class="modal-overlay">
    <div class="modal-content">
        <h3>📝 注册</h3>
        <form method="post">
            <input type="text" name="username" placeholder="用户名" required>
            <input type="text" name="nickname" placeholder="昵称（可选）">
            <input type="password" name="password" placeholder="密码" required>
            <input type="password" name="confirm_password" placeholder="确认密码" required>
            <input type="hidden" name="action" value="register">
            <?php if ($reg_error !== ''): ?><p style="color: #f87171;"><?php echo h($reg_error); ?></p><?php endif; ?>
            <?php if ($reg_success !== ''): ?><p style="color: #10b981;"><?php echo h($reg_success); ?></p><?php endif; ?>
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="hideModal('registerModal')">取消</button>
                <button type="submit" class="btn-primary">注册</button>
            </div>
        </form>
    </div>
</div>

<!-- 发帖弹窗 -->
<div id="createPostModal" class="modal-overlay">
    <div class="modal-content">
        <h3>📝 发布新帖</h3>
        <form method="post">
            <input type="text" name="title" placeholder="标题" required>
            <select name="category">
                <?php foreach ($CONFIG->categories as $cat): ?>
                <option value="<?php echo h($cat); ?>"><?php echo h($cat); ?></option>
                <?php endforeach; ?>
            </select>
            <input type="text" name="tags" placeholder="标签（用逗号分隔）">
            <textarea name="content" placeholder="内容" required style="min-height: 150px;"></textarea>
            <input type="hidden" name="action" value="new_post">
            <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="hideModal('createPostModal')">取消</button>
                <button type="submit" class="btn-primary">发布</button>
            </div>
        </form>
    </div>
</div>

<!-- 创建聊天室弹窗 -->
<div id="createChatModal" class="modal-overlay">
    <div class="modal-content">
        <h3>➕ 创建聊天室</h3>
        <form method="post">
            <input type="text" name="name" placeholder="聊天室名称" required>
            <select name="type">
                <option value="public">🌐 公开</option>
                <option value="private">🔒 私密</option>
            </select>
            <input type="password" name="password" placeholder="私密密码（可选）">
            <div style="margin: 10px 0;">
                <input type="checkbox" name="require_approval" id="require_approval" value="1">
                <label for="require_approval">需要审核</label>
            </div>
            <input type="hidden" name="action" value="create_chat">
            <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="hideModal('createChatModal')">取消</button>
                <button type="submit" class="btn-primary">创建</button>
            </div>
        </form>
    </div>
</div>

<!-- 好友列表弹窗 -->
<div id="friendsModal" class="modal-overlay">
    <div class="modal-content">
        <h3>👥 好友列表</h3>
        <?php 
        $friends_list = $friends[$_SESSION['user']] ?? [];
        if (empty($friends_list)): ?>
        <p style="color: #9ca3af; text-align: center; padding: 20px;">暂无好友</p>
        <?php else: ?>
        <?php foreach ($friends_list as $friend): ?>
        <div class="friend-item">
            <span class="friend-name"><?php echo h($friend); ?></span>
            <div class="friend-actions">
                <a href="?tab=chat&private=<?php echo urlencode($friend); ?>" class="friend-action">💬</a>
                <span class="friend-action" onclick="removeFriend('<?php echo $friend; ?>')">✕</span>
            </div>
        </div>
        <?php endforeach; ?>
        <?php endif; ?>
        <h4 style="color: #facc15; margin: 15px 0 10px;">添加好友</h4>
        <form method="post">
            <input type="text" name="friend" placeholder="用户名" required>
            <input type="hidden" name="action" value="add_friend">
            <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
            <button type="submit" class="btn-primary" style="width: 100%;">添加</button>
        </form>
        <div class="modal-actions"><button class="btn-secondary" onclick="hideModal('friendsModal')">关闭</button></div>
    </div>
</div>

<!-- 黑名单弹窗 -->
<div id="blocksModal" class="modal-overlay">
    <div class="modal-content">
        <h3>🚫 黑名单</h3>
        <?php 
        $blocks_list = $blocks[$_SESSION['user']] ?? [];
        if (empty($blocks_list)): ?>
        <p style="color: #9ca3af; text-align: center; padding: 20px;">暂无黑名单</p>
        <?php else: ?>
        <?php foreach ($blocks_list as $blocked => $time): ?>
        <div class="friend-item">
            <span class="friend-name" style="color: #ef4444;"><?php echo h($blocked); ?></span>
            <span class="friend-action" onclick="unblockUser('<?php echo $blocked; ?>')">解除</span>
        </div>
        <?php endforeach; ?>
        <?php endif; ?>
        <div class="modal-actions"><button class="btn-secondary" onclick="hideModal('blocksModal')">关闭</button></div>
    </div>
</div>

<!-- 私聊设置弹窗 -->
<div id="privateModal" class="modal-overlay">
    <div class="modal-content">
        <h3>⚙️ 私聊设置</h3>
        <p>与 <?php echo h($private_with); ?> 的私聊</p>
        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 20px;">
            <button class="user-btn" onclick="addFriend('<?php echo $private_with; ?>')">➕ 加好友</button>
            <button class="user-btn" onclick="blockUser('<?php echo $private_with; ?>')">🚫 拉黑</button>
            <button class="user-btn" onclick="clearPrivate('<?php echo $private_with; ?>')">🗑️ 清空记录</button>
        </div>
        <div class="modal-actions"><button class="btn-secondary" onclick="hideModal('privateModal')">关闭</button></div>
    </div>
</div>

<!-- 管理聊天室弹窗 -->
<div id="manageRoomModal" class="modal-overlay">
    <div class="modal-content">
        <h3>⚙️ 管理聊天室</h3>
        <?php if ($currentRoom !== null && is_array($currentRoom)): ?>
        <h4 style="color: #facc15; margin: 10px 0;">成员管理</h4>
        <div class="member-list" style="max-height: 200px;">
            <?php foreach (($currentRoom['members'] ?? []) as $member => $info): ?>
            <?php if ($member !== $_SESSION['user'] && is_array($info)): ?>
            <div class="member-item" style="justify-content: space-between;">
                <span><?php echo h($users[$member]['nickname'] ?? $member); ?></span>
                <div style="display: flex; gap: 5px;">
                    <?php if (!in_array($member, $currentRoom['admins'] ?? [], true) && $member !== ($currentRoom['owner'] ?? '')): ?>
                    <button class="friend-action" onclick="roomAction('set_admin', '<?php echo $member; ?>')">👑 设为管理</button>
                    <?php elseif (in_array($member, $currentRoom['admins'] ?? [], true)): ?>
                    <button class="friend-action" onclick="roomAction('remove_admin', '<?php echo $member; ?>')">⬇️ 取消管理</button>
                    <?php endif; ?>
                    <?php if (empty($info['muted'])): ?>
                    <button class="friend-action" onclick="roomAction('mute_member', '<?php echo $member; ?>')">🔇 禁言</button>
                    <?php else: ?>
                    <button class="friend-action" onclick="roomAction('unmute_member', '<?php echo $member; ?>')">🔊 解禁</button>
                    <?php endif; ?>
                    <button class="friend-action" onclick="roomAction('kick_member', '<?php echo $member; ?>')">✕ 移除</button>
                </div>
            </div>
            <?php endif; ?>
            <?php endforeach; ?>
        </div>
        
        <h4 style="color: #facc15; margin: 15px 0 10px;">聊天室设置</h4>
        <button class="user-btn" onclick="roomAction('toggle_all_mute', '')"><?php echo !empty($currentRoom['settings']['all_muted']) ? '关闭全员禁言' : '开启全员禁言'; ?></button>
        
        <?php if (($currentRoom['owner'] ?? '') === $_SESSION['user'] || isAdmin()): ?>
        <h4 style="color: #facc15; margin: 15px 0 10px;">危险操作</h4>
        <button class="user-btn" style="background: #ef4444;" onclick="roomAction('delete_chatroom', '')">🗑️ 解散聊天室</button>
        <?php endif; ?>
        <?php endif; ?>
        <div class="modal-actions"><button class="btn-secondary" onclick="hideModal('manageRoomModal')">关闭</button></div>
    </div>
</div>

<!-- 编辑资料弹窗 -->
<div id="profileEditModal" class="modal-overlay">
    <div class="modal-content">
        <h3>✏️ 编辑资料</h3>
        <form method="post" enctype="multipart/form-data">
            <input type="text" name="nickname" placeholder="昵称" value="<?php echo h($currentUser['nickname'] ?? ''); ?>">
            <input type="file" name="avatar" accept="image/*">
            <input type="hidden" name="action" value="update_profile">
            <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="hideModal('profileEditModal')">取消</button>
                <button type="submit" class="btn-primary">保存</button>
            </div>
        </form>
        <p style="color: #9ca3af; font-size: 12px; margin-top: 10px;">头像将自动裁剪为100x100像素</p>
    </div>
</div>

<!-- 修改密码弹窗 -->
<div id="changePasswordModal" class="modal-overlay">
    <div class="modal-content">
        <h3>🔑 修改密码</h3>
        <form method="post">
            <input type="password" name="old_password" placeholder="原密码" required>
            <input type="password" name="new_password" placeholder="新密码" required>
            <input type="password" name="confirm_password" placeholder="确认新密码" required>
            <input type="hidden" name="action" value="change_password">
            <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="hideModal('changePasswordModal')">取消</button>
                <button type="submit" class="btn-primary">修改密码</button>
            </div>
        </form>
    </div>
</div>

<!-- 称号中心弹窗 -->
<div id="titleModal" class="modal-overlay">
    <div class="modal-content">
        <h3>🎖️ 称号中心</h3>
        <p>当前称号：<strong><?php echo $userTitle !== '' ? h($userTitle) : '无自定义称号'; ?></strong></p>
        <p>价格：<?php echo TITLE_PRICE; ?> 资本币 | 你的余额：<?php echo (int)($currentUser['coin'] ?? 0); ?></p>
        <form method="post">
            <input type="text" name="title" placeholder="输入你的自定义称号（1-20字符）" maxlength="20" required>
            <input type="hidden" name="action" value="buy_title">
            <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="hideModal('titleModal')">取消</button>
                <button type="submit" class="btn-primary">购买称号</button>
            </div>
        </form>
        <p style="color: #9ca3af; font-size: 12px; margin-top: 10px;">※ 称号不可重复，购买后永久拥有</p>
    </div>
</div>

<!-- 打赏弹窗 -->
<div id="donateModal" class="modal-overlay">
    <div class="modal-content">
        <h3>💰 打赏作者</h3>
        <form method="post">
            <input type="hidden" name="to_user" id="donateToUser" value="">
            <input type="hidden" name="post_id" id="donatePostId" value="">
            <div style="margin-bottom: 15px;">
                <span>打赏给：<strong id="donateUserName"></strong></span>
            </div>
            <div style="margin-bottom: 15px;">
                <label>金额（资本币）：</label>
                <input type="number" name="amount" min="1" value="10" required style="width: 100%;">
            </div>
            <div style="margin-bottom: 15px;">
                <label>留言（可选）：</label>
                <textarea name="message" placeholder="说点什么..." style="width: 100%; min-height: 60px;"></textarea>
            </div>
            <input type="hidden" name="action" value="donate">
            <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="hideModal('donateModal')">取消</button>
                <button type="submit" class="btn-primary">确认打赏</button>
            </div>
        </form>
    </div>
</div>

<!-- 设置帖子价格弹窗 -->
<div id="setPriceModal" class="modal-overlay">
    <div class="modal-content">
        <h3>💰 设置帖子价格</h3>
        <form method="post">
            <input type="hidden" name="post_id" id="setPricePostId" value="">
            <div style="margin-bottom: 15px;">
                <label>价格（0表示免费）：</label>
                <input type="number" name="price" min="0" value="0" required style="width: 100%;">
            </div>
            <p style="color: #9ca3af; font-size: 12px;">设置为付费后，其他用户需要支付才能查看完整内容。</p>
            <input type="hidden" name="action" value="set_post_price">
            <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="hideModal('setPriceModal')">取消</button>
                <button type="submit" class="btn-primary">保存设置</button>
            </div>
        </form>
    </div>
</div>

<!-- 弹幕发送弹窗 -->
<div id="danmakuModal" class="modal-overlay">
    <div class="modal-content">
        <h3>📺 发送弹幕</h3>
        <div style="margin-bottom: 15px;">
            <input type="text" id="danmakuText" placeholder="输入弹幕内容（最多50字）" maxlength="50" style="width: 100%;">
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
            <div>
                <label>颜色：</label>
                <input type="color" id="danmakuColor" value="#ffffff">
            </div>
            <div>
                <label>大小：</label>
                <select id="danmakuSize">
                    <option value="14">普通</option>
                    <option value="18">大号</option>
                    <option value="24">超大</option>
                </select>
            </div>
        </div>
        <div style="margin-bottom: 15px;">
            <label>位置：</label>
            <select id="danmakuPosition">
                <option value="0">滚动弹幕</option>
                <option value="1">顶部固定</option>
                <option value="2">底部固定</option>
            </select>
        </div>
        <input type="hidden" id="danmakuPostId" value="">
        <div class="modal-actions">
            <button type="button" class="btn-secondary" onclick="hideModal('danmakuModal')">取消</button>
            <button type="button" class="btn-primary" onclick="sendDanmaku()">发送</button>
        </div>
    </div>
</div>

<!-- 举报弹窗 -->
<div id="reportModal" class="modal-overlay">
    <div class="modal-content">
        <h3>⚖️ 提交举报</h3>
        <form method="post">
            <input type="text" name="reported" placeholder="被举报人用户名" required>
            <textarea name="reason" placeholder="举报理由" required></textarea>
            <input type="text" name="evidence" placeholder="证据链接（可选）">
            <div style="margin: 10px 0;">
                <input type="checkbox" name="anonymous" id="anonymous" value="1">
                <label for="anonymous">匿名举报</label>
            </div>
            <input type="hidden" name="action" value="report">
            <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="hideModal('reportModal')">取消</button>
                <button type="submit" class="btn-primary">提交</button>
            </div>
        </form>
    </div>
</div>

<!-- 申诉弹窗 -->
<div id="appealModal" class="modal-overlay">
    <div class="modal-content">
        <h3>📝 提交申诉</h3>
        <?php if ($currentUser !== null && isset($currentUser['banned'])): ?>
        <form method="post">
            <textarea name="reason" placeholder="申诉理由（解释为什么被封禁是冤枉的）" required></textarea>
            <input type="hidden" name="action" value="appeal">
            <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="hideModal('appealModal')">取消</button>
                <button type="submit" class="btn-primary">提交</button>
            </div>
        </form>
        <?php else: ?>
        <p style="color: #9ca3af;">你没有正在生效的封禁</p>
        <div class="modal-actions"><button class="btn-secondary" onclick="hideModal('appealModal')">关闭</button></div>
        <?php endif; ?>
    </div>
</div>

<!-- 编辑消息弹窗 -->
<div id="editMessageModal" class="modal-overlay">
    <div class="modal-content">
        <h3>✏️ 编辑消息</h3>
        <textarea id="editMsgContent" style="min-height: 100px; width: 100%; padding: 10px; margin: 10px 0; background: #2a2a3a; border: 1px solid #3a3a4a; border-radius: 12px; color: #fff;"></textarea>
        <input type="hidden" id="editRoomId">
        <input type="hidden" id="editMsgId">
        <div class="modal-actions">
            <button class="btn-secondary" onclick="hideModal('editMessageModal')">取消</button>
            <button class="btn-primary" onclick="submitEdit()">保存</button>
        </div>
    </div>
</div>

<!-- 消息历史弹窗 -->
<div id="historyModal" class="modal-overlay">
    <div class="modal-content">
        <h3>📜 编辑历史</h3>
        <div id="historyContent"></div>
        <div class="modal-actions">
            <button class="btn-secondary" onclick="hideModal('historyModal')">关闭</button>
        </div>
    </div>
</div>

<!-- 管理员 - 用户管理弹窗（已包含设置角色、编辑数据、修改昵称密码、位置共享控制） -->
<div id="adminUsersModal" class="modal-overlay">
    <div class="modal-content">
        <h3>👥 用户管理</h3>
        <?php foreach ($users as $uname => $u): ?>
            <?php if ($uname === 'admin' || $uname === $_SESSION['user']) continue; ?>
            <?php if (is_array($u)): ?>
            <div class="user-item">
                <div>
                    <strong><?php echo h($u['nickname'] ?? $uname); ?></strong> (@<?php echo h($uname); ?>)<br>
                    <small>等级:<?php echo $u['level'] ?? 1; ?> | 金币:<?php echo $u['coin'] ?? 0; ?> | 信誉:<?php echo $u['reputation'] ?? 50; ?></small>
                    <?php if (isset($u['banned'])): ?><span style="color: #ef4444; margin-left: 10px;">封禁中</span><?php endif; ?>
                    <?php if (!empty($u['latitude']) && !empty($u['longitude']) && ($u['location_sharing'] ?? 0)): ?>
                        <span style="color: #10b981; margin-left: 5px;">
                            <a href="https://www.google.com/maps?q=<?php echo $u['latitude']; ?>,<?php echo $u['longitude']; ?>" target="_blank" style="color: #10b981;">📍 查看地图</a>
                        </span>
                    <?php endif; ?>
                </div>
                <div class="user-item-actions">
                    <?php if (isset($u['banned'])): ?>
                    <button class="admin-btn" onclick="adminAction('unban_user', '<?php echo $uname; ?>')">解封</button>
                    <?php else: ?>
                    <button class="admin-btn" onclick="adminAction('ban_user', '<?php echo $uname; ?>', prompt('封禁小时数?', '24'))">封禁</button>
                    <button class="admin-btn" onclick="adminAction('ban_user', '<?php echo $uname; ?>', prompt('永久封禁?输入0表示永久', '0'))">永久封禁</button>
                    <?php endif; ?>
                    <button class="admin-btn logout" onclick="adminAction('delete_user', '<?php echo $uname; ?>')">删除</button>
                    <button class="admin-btn" onclick="setTrusted('<?php echo $uname; ?>', 1)">设为信任</button>
                    <button class="admin-btn" onclick="setTrusted('<?php echo $uname; ?>', 0)">取消信任</button>
                    <select onchange="setRole('<?php echo $uname; ?>', this.value)">
                        <option value="user" <?php echo ($u['role'] ?? '') == 'user' ? 'selected' : ''; ?>>普通用户</option>
                        <option value="reviewer" <?php echo ($u['role'] ?? '') == 'reviewer' ? 'selected' : ''; ?>>审核员</option>
                        <option value="admin" <?php echo ($u['role'] ?? '') == 'admin' ? 'selected' : ''; ?>>管理员</option>
                    </select>
                </div>
            </div>
            <!-- 快速编辑表单：资本币、信誉、经验、等级、昵称、密码、位置共享 -->
            <form method="post" style="margin-top:5px; margin-bottom:10px; display:flex; gap:5px; flex-wrap:wrap;">
                <input type="hidden" name="action" value="admin_edit_user_full">
                <input type="hidden" name="target_user" value="<?php echo $uname; ?>">
                <input type="number" name="coin" placeholder="资本币" value="<?php echo (int)$u['coin']; ?>" style="width:70px;">
                <input type="number" name="reputation" placeholder="信誉" value="<?php echo (int)$u['reputation']; ?>" style="width:70px;">
                <input type="number" name="exp" placeholder="经验" value="<?php echo (int)$u['exp']; ?>" style="width:70px;">
                <input type="number" name="level" placeholder="等级" value="<?php echo (int)$u['level']; ?>" style="width:70px;">
                <input type="text" name="nickname" placeholder="昵称" value="<?php echo h($u['nickname'] ?? ''); ?>" style="width:100px;">
                <input type="password" name="new_password" placeholder="新密码" style="width:100px;">
                <select name="sharing" onchange="this.form.submit()" style="width:120px;">
                    <option value="1" <?php echo ($u['location_sharing'] ?? 0) == 1 ? 'selected' : ''; ?>>位置共享开</option>
                    <option value="0" <?php echo ($u['location_sharing'] ?? 0) == 0 ? 'selected' : ''; ?>>位置共享关</option>
                </select>
                <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                <button type="submit" class="admin-btn">更新</button>
            </form>
            <?php endif; ?>
        <?php endforeach; ?>
        <div class="modal-actions"><button class="btn-secondary" onclick="hideModal('adminUsersModal')">关闭</button></div>
    </div>
</div>

<!-- 管理员 - 聊天室管理弹窗 -->
<div id="adminRoomsModal" class="modal-overlay">
    <div class="modal-content">
        <h3>💬 聊天室管理</h3>
        <?php foreach ($chats as $rid => $room): ?>
            <?php if ($rid === 'official') continue; ?>
            <?php if (is_array($room)): ?>
            <div class="room-item">
                <div>
                    <strong><?php echo h($room['name'] ?? '未知'); ?></strong><br>
                    <small>室主:<?php echo h($room['owner'] ?? ''); ?> | 成员:<?php echo count($room['members'] ?? []); ?></small>
                </div>
                <button class="admin-btn logout" onclick="adminAction('delete_chatroom', '<?php echo $rid; ?>')">解散</button>
            </div>
            <?php endif; ?>
        <?php endforeach; ?>
        <div class="modal-actions"><button class="btn-secondary" onclick="hideModal('adminRoomsModal')">关闭</button></div>
    </div>
</div>

<!-- 管理员 - 帖子管理弹窗 -->
<div id="adminPostsModal" class="modal-overlay">
    <div class="modal-content">
        <h3>📝 帖子管理</h3>
        <?php
        $allPosts = loadData(POSTS_FILE);
        $pendingPosts = [];
        if (is_array($allPosts)) {
            foreach ($allPosts as $p) {
                if (is_array($p) && ($p['status'] ?? '') === PostStatus::PENDING->value) {
                    $pendingPosts[] = $p;
                }
            }
        }
        if (empty($pendingPosts)): ?>
        <p style="color: #9ca3af;">暂无待审帖子</p>
        <?php else: ?>
        <?php foreach ($pendingPosts as $post): ?>
        <div class="post-card" style="padding: 15px;">
            <div><strong><?php echo h($post['title']); ?></strong> by <?php echo h($post['nickname']); ?></div>
            <div style="margin: 5px 0;"><?php echo h(mb_substr($post['content'], 0, 100)); ?>...</div>
            <div style="display: flex; gap: 10px;">
                <form method="post">
                    <input type="hidden" name="action" value="approve_post">
                    <input type="hidden" name="post_id" value="<?php echo $post['id']; ?>">
                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                    <button type="submit" class="btn-primary btn-approve">✅ 通过</button>
                </form>
                <form method="post">
                    <input type="hidden" name="action" value="reject_post">
                    <input type="hidden" name="post_id" value="<?php echo $post['id']; ?>">
                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                    <button type="submit" class="btn-primary btn-danger">❌ 拒绝</button>
                </form>
            </div>
        </div>
        <?php endforeach; ?>
        <?php endif; ?>
        <div class="modal-actions"><button class="btn-secondary" onclick="hideModal('adminPostsModal')">关闭</button></div>
    </div>
</div>

<!-- 管理员 - 广告审核弹窗 -->
<div id="adminAdsModal" class="modal-overlay">
    <div class="modal-content">
        <h3>📢 广告审核</h3>
        <?php
        $allAds = loadData(ADS_FILE);
        $pendingAds = [];
        if (is_array($allAds)) {
            foreach ($allAds as $a) {
                if (is_array($a) && ($a['status'] ?? '') === AdStatus::PENDING->value) {
                    $pendingAds[] = $a;
                }
            }
        }
        if (empty($pendingAds)): ?>
        <p style="color: #9ca3af;">暂无待审广告</p>
        <?php else: ?>
        <?php foreach ($pendingAds as $ad): ?>
        <div class="post-card" style="padding: 15px;">
            <div><strong><?php echo h($ad['title']); ?></strong> by <?php echo h($ad['owner']); ?></div>
            <div>链接：<?php echo h($ad['link']); ?></div>
            <?php if (!empty($ad['image'])): ?><img src="<?php echo h($ad['image']); ?>" style="max-width: 200px;"><?php endif; ?>
            <div style="display: flex; gap: 10px; margin-top: 10px;">
                <form method="post">
                    <input type="hidden" name="action" value="approve_ad">
                    <input type="hidden" name="ad_id" value="<?php echo $ad['id']; ?>">
                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                    <button type="submit" class="btn-primary btn-approve">✅ 通过</button>
                </form>
                <form method="post">
                    <input type="hidden" name="action" value="reject_ad">
                    <input type="hidden" name="ad_id" value="<?php echo $ad['id']; ?>">
                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                    <button type="submit" class="btn-primary btn-danger">❌ 拒绝</button>
                </form>
                <form method="post">
                    <input type="hidden" name="action" value="delete_ad">
                    <input type="hidden" name="ad_id" value="<?php echo $ad['id']; ?>">
                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                    <button type="submit" class="btn-primary btn-danger">🗑️ 删除</button>
                </form>
            </div>
        </div>
        <?php endforeach; ?>
        <?php endif; ?>
        <div class="modal-actions"><button class="btn-secondary" onclick="hideModal('adminAdsModal')">关闭</button></div>
    </div>
</div>

<!-- 管理员 - 法庭裁决弹窗 -->
<div id="adminCourtModal" class="modal-overlay">
    <div class="modal-content">
        <h3>⚖️ 法庭裁决</h3>
        <?php
        $pendingReports = loadReports(VoteResult::PENDING);
        if (empty($pendingReports)): ?>
        <p style="color: #9ca3af;">暂无待裁决案件</p>
        <?php else: ?>
        <?php foreach ($pendingReports as $report): ?>
        <?php if (is_array($report)): ?>
        <div class="post-card" style="padding: 15px;">
            <div>被举报人：<?php echo h($report['reported'] ?? ''); ?></div>
            <div>举报人：<?php echo !empty($report['reporter_anonymous']) ? '匿名' : h($report['reporter'] ?? ''); ?></div>
            <div>理由：<?php echo nl2br(h($report['reason'] ?? '')); ?></div>
            <div style="display: flex; gap: 10px; margin-top: 10px;">
                <form method="post">
                    <input type="hidden" name="action" value="judge_report">
                    <input type="hidden" name="report_id" value="<?php echo $report['id'] ?? ''; ?>">
                    <input type="hidden" name="decision" value="ban">
                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                    <button type="submit" class="btn-primary btn-danger">判决封禁</button>
                </form>
                <form method="post">
                    <input type="hidden" name="action" value="judge_report">
                    <input type="hidden" name="report_id" value="<?php echo $report['id'] ?? ''; ?>">
                    <input type="hidden" name="decision" value="noban">
                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                    <button type="submit" class="btn-primary btn-approve">判决不封禁</button>
                </form>
            </div>
        </div>
        <?php endif; ?>
        <?php endforeach; ?>
        <?php endif; ?>
        <div class="modal-actions"><button class="btn-secondary" onclick="hideModal('adminCourtModal')">关闭</button></div>
    </div>
</div>

<!-- 管理员 - 申诉处理弹窗 -->
<div id="adminAppealsModal" class="modal-overlay">
    <div class="modal-content">
        <h3>📋 申诉处理</h3>
        <?php
        $appeals = loadData(APPEALS_FILE);
        $pendingAppeals = [];
        if (is_array($appeals)) {
            foreach ($appeals as $a) {
                if (is_array($a) && ($a['status'] ?? '') === AppealStatus::PENDING->value) {
                    $pendingAppeals[] = $a;
                }
            }
        }
        if (empty($pendingAppeals)): ?>
        <p style="color: #9ca3af;">暂无待处理申诉</p>
        <?php else: ?>
        <?php foreach ($pendingAppeals as $appeal): ?>
        <div class="post-card" style="padding: 15px;">
            <div>用户：<?php echo h($appeal['user'] ?? ''); ?></div>
            <div>申诉理由：<?php echo nl2br(h($appeal['reason'] ?? '')); ?></div>
            <div style="display: flex; gap: 10px; margin-top: 10px;">
                <form method="post">
                    <input type="hidden" name="action" value="handle_appeal">
                    <input type="hidden" name="appeal_id" value="<?php echo $appeal['id'] ?? ''; ?>">
                    <input type="hidden" name="appeal_action" value="accept">
                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                    <button type="submit" class="btn-primary btn-approve">接受</button>
                </form>
                <form method="post">
                    <input type="hidden" name="action" value="handle_appeal">
                    <input type="hidden" name="appeal_id" value="<?php echo $appeal['id'] ?? ''; ?>">
                    <input type="hidden" name="appeal_action" value="reject">
                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                    <button type="submit" class="btn-primary btn-danger">拒绝</button>
                </form>
            </div>
        </div>
        <?php endforeach; ?>
        <?php endif; ?>
        <div class="modal-actions"><button class="btn-secondary" onclick="hideModal('adminAppealsModal')">关闭</button></div>
    </div>
</div>

<!-- 管理员 - 新闻管理弹窗 -->
<div id="adminNewsModal" class="modal-overlay">
    <div class="modal-content">
        <h3>📰 新闻管理</h3>
        <h4 style="color: #facc15;">添加新闻</h4>
        <form method="post">
            <input type="text" name="news_title" placeholder="标题" required>
            <input type="url" name="news_link" placeholder="链接（可选）">
            <textarea name="news_content" placeholder="内容（可选）" style="min-height: 80px;"></textarea>
            <input type="hidden" name="action" value="add_news">
            <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
            <button type="submit" class="btn-primary">添加</button>
        </form>
        <hr style="border-color: #3a3a4a; margin: 15px 0;">
        <h4 style="color: #facc15;">现有新闻</h4>
        <?php if (empty($newsList)): ?>
        <p style="color: #9ca3af;">暂无新闻</p>
        <?php else: ?>
        <?php foreach ($newsList as $news): ?>
        <?php if (is_array($news)): ?>
        <div class="post-card" style="padding: 10px;">
            <div><strong><?php echo h($news['title']); ?></strong> <span style="color: #9ca3af;"><?php echo date('Y-m-d', $news['time']); ?></span></div>
            <?php if (!empty($news['link'])): ?><div><a href="<?php echo h($news['link']); ?>" target="_blank">链接</a></div><?php endif; ?>
            <div style="display: flex; gap: 10px; margin-top: 5px;">
                <form method="post">
                    <input type="hidden" name="action" value="delete_news">
                    <input type="hidden" name="news_id" value="<?php echo $news['id']; ?>">
                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                    <button type="submit" class="btn-danger" style="padding: 2px 10px;">删除</button>
                </form>
            </div>
        </div>
        <?php endif; ?>
        <?php endforeach; ?>
        <?php endif; ?>
        <div class="modal-actions"><button class="btn-secondary" onclick="hideModal('adminNewsModal')">关闭</button></div>
    </div>
</div>

<!-- 管理员 - 操作日志弹窗 -->
<div id="adminLogsModal" class="modal-overlay">
    <div class="modal-content">
        <h3>📋 操作日志</h3>
        <?php if (empty($logs)): ?>
        <p style="color: #9ca3af;">暂无日志</p>
        <?php else: ?>
        <?php foreach ($logs as $log): ?>
        <?php if (is_array($log)): ?>
        <div style="font-size: 12px; border-bottom: 1px solid #2a2a3a; padding: 5px 0;">
            <span style="color: #9ca3af;"><?php echo date('Y-m-d H:i:s', $log['time']); ?></span> - 
            <span style="color: #facc15;"><?php echo h($log['user']); ?></span>: 
            <?php echo h($log['action']); ?>
        </div>
        <?php endif; ?>
        <?php endforeach; ?>
        <?php endif; ?>
        <div class="modal-actions"><button class="btn-secondary" onclick="hideModal('adminLogsModal')">关闭</button></div>
    </div>
</div>

<!-- 管理员 - 系统设置弹窗 -->
<div id="adminConfigModal" class="modal-overlay">
    <div class="modal-content">
        <h3>⚙️ 系统设置</h3>
        <form method="post">
            <div class="config-item">
                <label>公告内容</label>
                <input type="text" name="notice_text" value="<?php echo h($CONFIG->noticeText); ?>">
            </div>
            <div class="config-item">
                <label><input type="checkbox" name="show_notice" value="1" <?php echo $CONFIG->showNotice ? 'checked' : ''; ?>> 显示公告</label>
            </div>
            <div class="config-item">
                <label>背景音乐URL</label>
                <input type="text" name="bg_music_url" value="<?php echo h($CONFIG->bgMusicUrl); ?>">
            </div>
            <input type="hidden" name="action" value="update_notice">
            <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
            <button type="submit" class="btn-primary">保存公告/音乐</button>
        </form>
        <hr style="border-color: #3a3a4a; margin: 15px 0;">
        <form method="post">
            <div class="config-item">
                <label>最大消息数</label>
                <input type="number" name="config_value" value="<?php echo $CONFIG->maxMessages; ?>">
                <input type="hidden" name="config_key" value="max_messages">
            </div>
            <div class="config-item">
                <label>撤回超时(秒)</label>
                <input type="number" name="config_value" value="<?php echo $CONFIG->recallTimeout; ?>">
                <input type="hidden" name="config_key" value="recall_timeout">
            </div>
            <div class="config-item">
                <label>广告价格</label>
                <input type="number" name="config_value" value="<?php echo $CONFIG->adPrice; ?>">
                <input type="hidden" name="config_key" value="ad_price">
            </div>
            <div class="config-item">
                <label>广告时长(天)</label>
                <input type="number" name="config_value" value="<?php echo $CONFIG->adDuration; ?>">
                <input type="hidden" name="config_key" value="ad_duration">
            </div>
            <input type="hidden" name="action" value="update_config">
            <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
            <button type="submit" class="btn-primary">保存配置</button>
        </form>
        <div class="modal-actions"><button class="btn-secondary" onclick="hideModal('adminConfigModal')">关闭</button></div>
    </div>
</div>

<!-- 审核员 - 待审帖子弹窗 -->
<div id="reviewerPostsModal" class="modal-overlay">
    <div class="modal-content">
        <h3>📝 待审帖子</h3>
        <?php
        $allPosts = loadData(POSTS_FILE);
        $pendingPosts = [];
        if (is_array($allPosts)) {
            foreach ($allPosts as $p) {
                if (is_array($p) && ($p['status'] ?? '') === PostStatus::PENDING->value) {
                    $pendingPosts[] = $p;
                }
            }
        }
        if (empty($pendingPosts)): ?>
        <p style="color: #9ca3af;">暂无待审帖子</p>
        <?php else: ?>
        <?php foreach ($pendingPosts as $post): ?>
        <div class="post-card" style="padding: 15px;">
            <div><strong><?php echo h($post['title']); ?></strong> by <?php echo h($post['nickname']); ?></div>
            <div style="margin: 5px 0;"><?php echo h(mb_substr($post['content'], 0, 100)); ?>...</div>
            <div style="display: flex; gap: 10px;">
                <form method="post">
                    <input type="hidden" name="action" value="approve_post">
                    <input type="hidden" name="post_id" value="<?php echo $post['id']; ?>">
                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                    <button type="submit" class="btn-primary btn-approve">✅ 通过</button>
                </form>
                <form method="post">
                    <input type="hidden" name="action" value="reject_post">
                    <input type="hidden" name="post_id" value="<?php echo $post['id']; ?>">
                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                    <button type="submit" class="btn-primary btn-danger">❌ 拒绝</button>
                </form>
            </div>
        </div>
        <?php endforeach; ?>
        <?php endif; ?>
        <div class="modal-actions"><button class="btn-secondary" onclick="hideModal('reviewerPostsModal')">关闭</button></div>
    </div>
</div>

<!-- 审核员 - 待审广告弹窗 -->
<div id="reviewerAdsModal" class="modal-overlay">
    <div class="modal-content">
        <h3>📢 待审广告</h3>
        <?php
        $allAds = loadData(ADS_FILE);
        $pendingAds = [];
        if (is_array($allAds)) {
            foreach ($allAds as $a) {
                if (is_array($a) && ($a['status'] ?? '') === AdStatus::PENDING->value) {
                    $pendingAds[] = $a;
                }
            }
        }
        if (empty($pendingAds)): ?>
        <p style="color: #9ca3af;">暂无待审广告</p>
        <?php else: ?>
        <?php foreach ($pendingAds as $ad): ?>
        <div class="post-card" style="padding: 15px;">
            <div><strong><?php echo h($ad['title']); ?></strong> by <?php echo h($ad['owner']); ?></div>
            <div>链接：<?php echo h($ad['link']); ?></div>
            <?php if (!empty($ad['image'])): ?><img src="<?php echo h($ad['image']); ?>" style="max-width: 200px;"><?php endif; ?>
            <div style="display: flex; gap: 10px; margin-top: 10px;">
                <form method="post">
                    <input type="hidden" name="action" value="approve_ad">
                    <input type="hidden" name="ad_id" value="<?php echo $ad['id']; ?>">
                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                    <button type="submit" class="btn-primary btn-approve">✅ 通过</button>
                </form>
                <form method="post">
                    <input type="hidden" name="action" value="reject_ad">
                    <input type="hidden" name="ad_id" value="<?php echo $ad['id']; ?>">
                    <input type="hidden" name="token" value="<?php echo $_SESSION['token'] ?? ''; ?>">
                    <button type="submit" class="btn-primary btn-danger">❌ 拒绝</button>
                </form>
            </div>
        </div>
        <?php endforeach; ?>
        <?php endif; ?>
        <div class="modal-actions"><button class="btn-secondary" onclick="hideModal('reviewerAdsModal')">关闭</button></div>
    </div>
</div>

<!-- 音乐和声音 -->
<?php if ($CONFIG->bgMusicUrl !== ''): ?>
<button class="music-fab" id="musicFab">⏸️</button>
<audio id="bgMusic" src="<?php echo h($CONFIG->bgMusicUrl); ?>" loop preload="auto" style="display: none;"></audio>
<?php endif; ?>
<div class="sound-toggle on" id="soundToggle" onclick="toggleSound()">🔊</div>
<audio id="notifySound" preload="auto" style="display: none;">
    <source src="data:audio/mpeg;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gTG9uZG9uU291bmRzLmNvbQAAAFRtc1VVVVUAAADUAAAAH1RSdXN0AAAAAgAAAFRtc1VVVVUAAADUAAAAIFRSdXN0AAAAAgAAAFRtc1VVVVUAAADUAAAAIFRSdXN0AAAAAgAAAFRtc1VVVVUAAADUAAAAIFRSdXN0AAAAAg==">
</audio>

<script>
var lastMsgTime = <?php echo $last_msg_time; ?>;
var sound = true;
var room = '<?php echo $room_id; ?>';
var user = '<?php echo $_SESSION['user'] ?? ''; ?>';
var danmakuTimer = null;
var currentDanmakuPost = '';

// 位置共享开关
var locationToggle = document.getElementById('locationSharingToggle');
if (locationToggle) {
    locationToggle.addEventListener('change', function() {
        var sharing = this.checked ? 1 : 0;
        var formData = 'action=update_my_location_sharing&sharing=' + sharing + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
        fetch('', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                if (sharing) {
                    requestLocation();
                } else {
                    document.getElementById('locationStatus').innerText = '位置共享已关闭';
                }
            } else {
                alert('更新状态失败');
                locationToggle.checked = !sharing;
            }
        })
        .catch(function(e) {
            alert('请求失败: ' + e.message);
            locationToggle.checked = !sharing;
        });
    });
}

function requestLocation() {
    if (!navigator.geolocation) {
        alert('您的浏览器不支持地理位置');
        locationToggle.checked = false;
        return;
    }
    navigator.geolocation.getCurrentPosition(
        function(pos) {
            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;
            var data = 'action=update_my_location&latitude=' + lat + '&longitude=' + lng + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
            fetch('', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: data
            })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (d.success) {
                    document.getElementById('locationStatus').innerText = '位置已获取';
                } else {
                    alert('位置保存失败: ' + d.error);
                    locationToggle.checked = false;
                }
            })
            .catch(function(e) {
                alert('位置保存请求失败: ' + e.message);
                locationToggle.checked = false;
            });
        },
        function(err) {
            var msg = '无法获取位置: ';
            switch(err.code) {
                case err.PERMISSION_DENIED:
                    msg += '用户拒绝了位置请求';
                    break;
                case err.POSITION_UNAVAILABLE:
                    msg += '位置信息不可用';
                    break;
                case err.TIMEOUT:
                    msg += '请求超时';
                    break;
                default:
                    msg += err.message;
            }
            alert(msg);
            locationToggle.checked = false;
        },
        { timeout: 10000, maximumAge: 60000, enableHighAccuracy: true }
    );
}

function showModal(id) {
    var el = document.getElementById(id);
    if (el) {
        el.style.visibility = 'visible';
        el.style.opacity = '1';
    }
}

function hideModal(id) {
    var el = document.getElementById(id);
    if (el) {
        el.style.visibility = 'hidden';
        el.style.opacity = '0';
    }
}

var modals = document.querySelectorAll('.modal-overlay');
for (var i = 0; i < modals.length; i++) {
    modals[i].onclick = function(e) {
        if (e.target === this) {
            hideModal(this.id);
        }
    };
}

function sendRoom() {
    var inp = document.getElementById('msgInput');
    if (!inp) return;
    var msg = inp.value.trim();
    if (!msg) return;
    
    var formData = 'action=send_chat&room_id=' + encodeURIComponent(room) + '&message=' + encodeURIComponent(msg) + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
    
    fetch('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if (d.success) {
            inp.value = '';
            addMsg(d.message);
            playSound();
        } else {
            alert(d.error);
        }
    })
    .catch(function(e) { console.error(e); });
}

function sendPrivate() {
    var inp = document.getElementById('msgInput');
    if (!inp) return;
    var msg = inp.value.trim();
    var to = '<?php echo $private_with; ?>';
    if (!msg || !to) return;
    
    var formData = 'action=send_private&to=' + encodeURIComponent(to) + '&message=' + encodeURIComponent(msg) + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
    
    fetch('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if (d.success) {
            inp.value = '';
            addMsg(d.message);
            playSound();
        } else {
            alert(d.error);
        }
    })
    .catch(function(e) { console.error(e); });
}

var pollInterval = 5000;
function checkNew() {
    if (!room || !user) return;
    
    setTimeout(function() {
        var formData = 'action=get_new_messages&room_id=' + encodeURIComponent(room) + '&last_time=' + lastMsgTime;
        
        fetch('', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success && d.messages && d.messages.length) {
                for (var i = 0; i < d.messages.length; i++) {
                    addMsg(d.messages[i]);
                    if (d.messages[i].u != user) playSound();
                    
                    if (d.messages[i].room && d.messages[i].room.startsWith('p_') && d.messages[i].u != user) {
                        var other = d.messages[i].u;
                        if (room !== d.messages[i].room) {
                            var dot = document.querySelector(`.chat-item[data-private="${other}"] .unread-dot`);
                            if (dot) dot.style.display = 'inline-block';
                        }
                    }
                }
                lastMsgTime = d.messages[d.messages.length - 1].t;
            }
        })
        .catch(function(e) { console.error(e); });
        
        checkNew();
    }, pollInterval);
}

function addMsg(m) {
    if (!m || typeof m !== 'object') return;
    
    var box = document.getElementById('chatMessages');
    if (!box) return;
    
    var div = document.createElement('div');
    div.className = 'message' + (m.u == user ? ' own' : '');
    div.dataset.id = m.id || '';
    div.dataset.time = m.t || 0;
    
    var header = '<div class="message-header">';
    if (m.u != user) {
        header += '<span class="message-user" onclick="location.href=\'?tab=chat&private=' + encodeURIComponent(m.u || '') + '\'">' + escapeHtml(m.n || '') + '</span>';
    }
    header += '<span class="message-time">' + escapeHtml(m.ts || '') + '</span>';
    if (m.edited) header += '<span class="edited">(已编辑)</span>';
    header += '</div>';
    
    var content = '<div class="message-content">' + escapeHtml(m.m || '').replace(/\n/g, '<br>') + '</div>';
    
    var footer = '';
    if (user && (m.u == user || <?php echo (isAdmin() || isReviewer()) ? 'true' : 'false'; ?>)) {
        footer = '<div class="message-footer">';
        if (m.u == user && (Math.floor(Date.now() / 1000) - (m.t || 0) < <?php echo $CONFIG->recallTimeout; ?>)) {
            footer += '<span onclick="recallMessage(\'' + room + '\',\'' + (m.id || '') + '\')">↩️ 撤回</span>';
        } else if (<?php echo (isAdmin() || isReviewer()) ? 'true' : 'false'; ?>) {
            footer += '<span onclick="recallMessage(\'' + room + '\',\'' + (m.id || '') + '\')">↩️ 撤回</span>';
        }
        if (<?php echo (isAdmin() || isReviewer()) ? 'true' : 'false'; ?> || m.u == user) {
            footer += '<span onclick="editMessage(\'' + room + '\',\'' + (m.id || '') + '\',\'' + escapeHtml(m.m || '').replace(/'/g, "\\'") + '\')">✏️ 编辑</span>';
        }
        if (m.history && m.history.length) {
            footer += '<span onclick="showHistory(\'' + room + '\',\'' + (m.id || '') + '\')">📜 历史</span>';
        }
        footer += '</div>';
    }
    
    div.innerHTML = header + content + footer;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

function recallMessage(roomId, msgId) {
    if (!roomId || !msgId) return;
    if (!confirm('确定撤回这条消息？')) return;
    
    var formData = 'action=recall_message&room_id=' + encodeURIComponent(roomId) + '&msg_id=' + encodeURIComponent(msgId) + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
    
    fetch('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if (d.success) {
            location.reload();
        } else {
            alert(d.error);
        }
    })
    .catch(function(e) { console.error(e); });
}

function editMessage(roomId, msgId, oldMsg) {
    document.getElementById('editRoomId').value = roomId;
    document.getElementById('editMsgId').value = msgId;
    document.getElementById('editMsgContent').value = oldMsg;
    showModal('editMessageModal');
}

function submitEdit() {
    var roomId = document.getElementById('editRoomId').value;
    var msgId = document.getElementById('editMsgId').value;
    var newMsg = document.getElementById('editMsgContent').value.trim();
    if (!newMsg) return;
    
    var formData = 'action=edit_message&room_id=' + encodeURIComponent(roomId) + '&msg_id=' + encodeURIComponent(msgId) + '&new_msg=' + encodeURIComponent(newMsg) + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
    
    fetch('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if (d.success) {
            hideModal('editMessageModal');
            location.reload();
        } else {
            alert(d.error);
        }
    })
    .catch(function(e) { console.error(e); });
}

function showHistory(roomId, msgId) {
    var formData = 'action=get_history&room_id=' + encodeURIComponent(roomId) + '&msg_id=' + encodeURIComponent(msgId) + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
    
    fetch('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if (d.success) {
            var html = '';
            for (var i = 0; i < d.history.length; i++) {
                var h = d.history[i];
                html += '<div style="background: #2a2a3a; padding: 10px; margin: 5px 0; border-radius: 8px">';
                html += '<small>' + new Date((h.t || 0) * 1000).toLocaleString() + '</small>';
                html += '<div>' + escapeHtml(h.m || '') + '</div></div>';
            }
            document.getElementById('historyContent').innerHTML = html || '<p>暂无历史</p>';
            showModal('historyModal');
        }
    })
    .catch(function(e) { console.error(e); });
}

function roomAction(action, target) {
    var data = 'action=' + action + '&room_id=' + encodeURIComponent(room) + '&target=' + encodeURIComponent(target) + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
    fetch('', { method: 'POST', body: data }).then(function() { location.reload(); }).catch(function(e) { console.error(e); });
}

function adminAction(action, username, hours) {
    var data = 'action=' + action + '&username=' + encodeURIComponent(username) + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
    if (hours !== undefined) {
        if (hours === '0' || hours === 0) {
            data += '&permanent=1';
        } else {
            data += '&hours=' + encodeURIComponent(hours);
        }
    }
    fetch('', { method: 'POST', body: data }).then(function() { location.reload(); }).catch(function(e) { console.error(e); });
}

function likePost(postId) {
    var formData = 'action=like_post&post_id=' + encodeURIComponent(postId) + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
    fetch('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
    }).then(function() { location.reload(); }).catch(function(e) { console.error(e); });
}

function dislikePost(postId) {
    var formData = 'action=dislike_post&post_id=' + encodeURIComponent(postId) + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
    fetch('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
    }).then(function() { location.reload(); }).catch(function(e) { console.error(e); });
}

function playSound() {
    if (sound) {
        var s = document.getElementById('notifySound');
        if (s) s.play();
    }
}

function toggleSound() {
    sound = !sound;
    var t = document.getElementById('soundToggle');
    t.className = 'sound-toggle ' + (sound ? 'on' : 'off');
    t.innerHTML = sound ? '🔊' : '🔇';
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function(m) {
        if (m == '&') return '&amp;';
        if (m == '<') return '&lt;';
        if (m == '>') return '&gt;';
        if (m == '"') return '&quot;';
        return m;
    });
}

function addFriend(f) {
    var formData = 'action=add_friend&friend=' + encodeURIComponent(f) + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
    fetch('', { method: 'POST', body: formData });
    setTimeout(function() { location.reload(); }, 500);
}

function blockUser(t) {
    if (confirm('确定拉黑？')) {
        var formData = 'action=block_user&target=' + encodeURIComponent(t) + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
        fetch('', { method: 'POST', body: formData });
        setTimeout(function() { location.reload(); }, 500);
    }
}

function unblockUser(t) {
    if (confirm('解除拉黑？')) {
        var formData = 'action=unblock_user&target=' + encodeURIComponent(t) + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
        fetch('', { method: 'POST', body: formData });
        setTimeout(function() { location.reload(); }, 500);
    }
}

function removeFriend(f) {
    if (confirm('删除好友？')) {
        var formData = 'action=remove_friend&friend=' + encodeURIComponent(f) + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
        fetch('', { method: 'POST', body: formData });
        setTimeout(function() { location.reload(); }, 500);
    }
}

function clearPrivate(t) {
    if (confirm('清空记录？')) {
        var formData = 'action=clear_private&target=' + encodeURIComponent(t) + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
        fetch('', { method: 'POST', body: formData });
        setTimeout(function() { location.href = '?tab=chat'; }, 500);
    }
}

function showDonateModal(toUser, postId, userName) {
    document.getElementById('donateToUser').value = toUser;
    document.getElementById('donatePostId').value = postId;
    document.getElementById('donateUserName').innerHTML = escapeHtml(userName);
    showModal('donateModal');
}

function showSetPriceModal(postId, currentPrice) {
    document.getElementById('setPricePostId').value = postId;
    document.getElementById('setPriceModal').querySelector('input[name="price"]').value = currentPrice;
    showModal('setPriceModal');
}

function showDanmakuModal(postId) {
    document.getElementById('danmakuPostId').value = postId;
    showModal('danmakuModal');
}

function sendDanmaku() {
    var postId = document.getElementById('danmakuPostId').value;
    var text = document.getElementById('danmakuText').value.trim();
    var color = document.getElementById('danmakuColor').value;
    var size = document.getElementById('danmakuSize').value;
    var position = document.getElementById('danmakuPosition').value;
    
    if (!text) {
        alert('弹幕内容不能为空');
        return;
    }
    
    var formData = 'action=send_danmaku&post_id=' + encodeURIComponent(postId) + '&text=' + encodeURIComponent(text) + 
                   '&color=' + encodeURIComponent(color) + '&size=' + size + '&position=' + position + 
                   '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
    
    fetch('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if (d.success) {
            hideModal('danmakuModal');
            document.getElementById('danmakuText').value = '';
            loadDanmaku(postId);
        } else {
            alert(d.error);
        }
    })
    .catch(function(e) { console.error(e); });
}

function loadDanmaku(postId) {
    var formData = 'action=get_danmaku&post_id=' + encodeURIComponent(postId) + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
    
    fetch('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if (d.success) {
            displayDanmaku(d.danmaku);
            document.getElementById('danmakuCount').innerHTML = (d.danmaku ? d.danmaku.length : 0) + ' 条弹幕';
        }
    })
    .catch(function(e) { console.error(e); });
}

function displayDanmaku(danmakuList) {
    var container = document.getElementById('danmakuContainer');
    if (!container) return;
    
    container.innerHTML = '';
    var width = container.offsetWidth;
    
    if (!danmakuList || !Array.isArray(danmakuList)) return;
    
    for (var i = 0; i < danmakuList.length; i++) {
        var d = danmakuList[i];
        if (!d) continue;
        
        var div = document.createElement('div');
        div.className = 'danmaku-item';
        div.style.position = 'absolute';
        div.style.color = d.color || '#ffffff';
        div.style.fontSize = (d.size || 14) + 'px';
        div.style.fontWeight = 'bold';
        div.style.textShadow = '1px 1px 2px #000';
        div.style.whiteSpace = 'nowrap';
        div.style.zIndex = '10';
        div.style.maxWidth = '80%';
        div.style.overflow = 'hidden';
        div.style.textOverflow = 'ellipsis';
        div.innerHTML = escapeHtml(d.nickname || '') + ': ' + escapeHtml(d.text || '');
        
        if (d.position == 1) {
            div.style.top = (20 + (i % 5) * 30) + 'px';
            div.style.left = '20px';
            div.style.animation = 'none';
        } else if (d.position == 2) {
            div.style.bottom = (20 + (i % 5) * 30) + 'px';
            div.style.left = '20px';
            div.style.animation = 'none';
        } else {
            div.style.top = Math.floor(Math.random() * 150) + 'px';
            div.style.left = width + 'px';
            div.className += ' danmaku-scroll';
            div.style.animation = 'scrollLeft ' + (<?php echo DANMAKU_SPEED; ?> / 1000) + 's linear forwards';
        }
        
        container.appendChild(div);
    }
}

if (!document.getElementById('danmakuStyle')) {
    var style = document.createElement('style');
    style.id = 'danmakuStyle';
    style.innerHTML = '@keyframes scrollLeft { from { left: 100%; } to { left: -100%; } }';
    document.head.appendChild(style);
}

<?php if ($CONFIG->bgMusicUrl !== ''): ?>
var music = document.getElementById('bgMusic');
var fab = document.getElementById('musicFab');
var playing = true;
if (music) {
    music.play().catch(function(e) { console.log('Autoplay prevented:', e); });
}

if (fab) {
    fab.onclick = function() {
        if (playing) {
            if (music) music.pause();
        } else {
            if (music) music.play().catch(function(e) { console.log('Play failed:', e); });
        }
        playing = !playing;
        fab.innerHTML = playing ? '⏸️' : '▶️';
    };
}
<?php endif; ?>

var dmToggle = document.getElementById('darkModeToggle');
if (dmToggle) {
    dmToggle.onclick = function() {
        var b = document.body;
        b.style.backgroundColor = b.style.backgroundColor === 'rgb(10,10,15)' ? '#1a1a2a' : '#0a0a0f';
    };
}

var chatBox = document.getElementById('chatMessages');
if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;

var leftToggle = document.getElementById('toggleLeftMenu');
var rightToggle = document.getElementById('toggleRightMenu');
var overlay = document.getElementById('sidebarOverlay');
var mainLayout = document.querySelector('.main-layout');

if (leftToggle && rightToggle && overlay && mainLayout) {
    leftToggle.addEventListener('click', function() {
        mainLayout.classList.toggle('show-left');
        if (mainLayout.classList.contains('show-right')) {
            mainLayout.classList.remove('show-right');
        }
    });
    rightToggle.addEventListener('click', function() {
        mainLayout.classList.toggle('show-right');
        if (mainLayout.classList.contains('show-left')) {
            mainLayout.classList.remove('show-left');
        }
    });
    overlay.addEventListener('click', function() {
        mainLayout.classList.remove('show-left', 'show-right');
    });
}

function setRole(username, role) {
    if (!confirm('确定将 ' + username + ' 的角色设置为 ' + role + ' 吗？')) return;
    var formData = 'action=set_role&username=' + encodeURIComponent(username) + '&role=' + encodeURIComponent(role) + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
    fetch('', { method: 'POST', body: formData }).then(function() { location.reload(); });
}

function setTrusted(username, value) {
    if (!confirm('确定' + (value ? '设为信任' : '取消信任') + '吗？')) return;
    var formData = 'action=set_trusted&username=' + encodeURIComponent(username) + '&trusted=' + value + '&token=<?php echo $_SESSION['token'] ?? ''; ?>';
    fetch('', { method: 'POST', body: formData }).then(function() { location.reload(); });
}

<?php if ($post_id !== '' && $currentUser !== null): ?>
currentDanmakuPost = '<?php echo $post_id; ?>';
loadDanmaku(currentDanmakuPost);

if (danmakuTimer) clearInterval(danmakuTimer);
danmakuTimer = setInterval(function() {
    if (currentDanmakuPost) {
        loadDanmaku(currentDanmakuPost);
    }
}, 10000);
<?php endif; ?>

<?php if ($currentUser !== null): ?>
setTimeout(checkNew, pollInterval);
<?php endif; ?>
</script>
</body>
</html>