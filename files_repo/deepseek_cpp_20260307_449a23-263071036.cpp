#include <iostream>
#include <string>
#include <cstring>
#include <sstream>
#include <thread>
#include <chrono>
#include <winsock2.h>
#include <windows.h>

#pragma comment(lib, "ws2_32.lib")

// ==================== 用户配置区域 ====================
std::string USERNAME   = "your_username";
std::string PASSWORD   = "your_password";
std::string DEVICE_ID  = "third-party-service-001";
std::string DEVICE_NAME = "ThirdPartyGateway";
std::string PLATFORM   = "server";
std::string APP_VERSION = "1.0.0";
// 轮询间隔（秒）
const int POLL_INTERVAL_SECONDS = 45;
// =====================================================

// 服务器地址和端口（登录接口和业务接口共用）
#define SERVER_IP   "60.205.94.101"
#define SERVER_PORT 8080

// 接口路径
#define LOGIN_PATH       "/v1/auth/login"
#define DIRECT_UNREAD_PATH "/v1/direct/unread"
#define GROUPS_UNREAD_PATH "/v1/groups/unread"

// ---------- 简单的 JSON 字段提取（同前）----------
std::string extract_json_string(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\":\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return "";
    pos += search.length();
    size_t end = json.find("\"", pos);
    if (end == std::string::npos) return "";
    return json.substr(pos, end - pos);
}

std::string extract_nested_string(const std::string& json, const std::string& outer, const std::string& inner) {
    std::string outer_search = "\"" + outer + "\":{";
    size_t outer_start = json.find(outer_search);
    if (outer_start == std::string::npos) return "";
    outer_start += outer_search.length();
    int brace_level = 1;
    size_t outer_end = outer_start;
    while (outer_end < json.length() && brace_level > 0) {
        if (json[outer_end] == '{') brace_level++;
        else if (json[outer_end] == '}') brace_level--;
        outer_end++;
    }
    std::string outer_content = json.substr(outer_start, outer_end - outer_start - 1);
    return extract_json_string(outer_content, inner);
}

// ---------- 通用 HTTP POST 请求（JSON 格式，带 Bearer 认证）----------
// 返回 HTTP 响应体（空字符串表示失败），如果 token 为空则不带 Authorization 头
std::string http_post_json(const std::string& path, const std::string& json_body, const std::string& token = "") {
    WSADATA wsaData;
    SOCKET sock = INVALID_SOCKET;
    struct sockaddr_in server_addr;
    char recv_buf[8192];
    int result;

    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        std::cerr << "WSAStartup failed" << std::endl;
        return "";
    }

    sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) {
        std::cerr << "socket failed: " << WSAGetLastError() << std::endl;
        WSACleanup();
        return "";
    }

    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(SERVER_PORT);
    server_addr.sin_addr.s_addr = inet_addr(SERVER_IP);
    if (server_addr.sin_addr.s_addr == INADDR_NONE) {
        std::cerr << "Invalid IP address" << std::endl;
        closesocket(sock);
        WSACleanup();
        return "";
    }

    if (connect(sock, (struct sockaddr*)&server_addr, sizeof(server_addr)) == SOCKET_ERROR) {
        int err = WSAGetLastError();
        std::cerr << "connect failed, error code: " << err << std::endl;
        closesocket(sock);
        WSACleanup();
        return "";
    }

    // 构建 HTTP 请求
    std::ostringstream request_stream;
    request_stream << "POST " << path << " HTTP/1.1\r\n"
                   << "Host: " << SERVER_IP << ":" << SERVER_PORT << "\r\n"
                   << "Content-Type: application/json\r\n";
    if (!token.empty()) {
        request_stream << "Authorization: Bearer " << token << "\r\n";
    }
    request_stream << "Content-Length: " << json_body.length() << "\r\n"
                   << "Connection: close\r\n"
                   << "\r\n"
                   << json_body;
    std::string http_request = request_stream.str();

    if (send(sock, http_request.c_str(), http_request.length(), 0) == SOCKET_ERROR) {
        std::cerr << "send failed: " << WSAGetLastError() << std::endl;
        closesocket(sock);
        WSACleanup();
        return "";
    }

    // 接收响应
    std::string response;
    do {
        memset(recv_buf, 0, sizeof(recv_buf));
        result = recv(sock, recv_buf, sizeof(recv_buf) - 1, 0);
        if (result > 0) {
            response.append(recv_buf, result);
        } else if (result == 0) {
            break;
        } else {
            std::cerr << "recv failed: " << WSAGetLastError() << std::endl;
            closesocket(sock);
            WSACleanup();
            return "";
        }
    } while (result > 0);

    closesocket(sock);
    WSACleanup();

    // 检查 HTTP 状态码（简单判断是否包含 200 OK）
    if (response.find("200 OK") == std::string::npos) {
        std::cerr << "HTTP request failed, response:\n" << response << std::endl;
        return "";
    }

    // 提取响应体（空行之后）
    size_t body_start = response.find("\r\n\r\n");
    if (body_start == std::string::npos) {
        std::cerr << "Invalid HTTP response" << std::endl;
        return "";
    }
    return response.substr(body_start + 4);
}

// ---------- 登录函数（复用之前的逻辑，但改用通用函数简化）----------
bool http_login(const std::string& username, const std::string& password,
                std::string& out_token, std::string& out_sid) {
    std::string json_body = "{"
        "\"identifier\":\"" + username + "\","
        "\"password\":\"" + password + "\","
        "\"device_id\":\"" + DEVICE_ID + "\","
        "\"device_name\":\"" + DEVICE_NAME + "\","
        "\"platform\":\"" + PLATFORM + "\","
        "\"app_version\":\"" + APP_VERSION + "\""
        "}";

    std::string response_body = http_post_json(LOGIN_PATH, json_body, "");
    if (response_body.empty()) {
        return false;
    }

    out_token = extract_json_string(response_body, "access_token");
    if (out_token.empty()) {
        std::cerr << "Failed to extract access_token" << std::endl;
        return false;
    }

    out_sid = extract_nested_string(response_body, "user", "id");
    if (out_sid.empty()) {
        std::cerr << "Failed to extract user.id" << std::endl;
        return false;
    }

    std::cout << "Login successful.\n"
              << "access_token: " << out_token << "\n"
              << "sid (user.id): " << out_sid << std::endl;
    return true;
}

// ---------- 轮询函数：调用私聊和群聊未读接口 ----------
void poll_unread(const std::string& token) {
    std::cout << "[" << std::time(nullptr) << "] Polling unread messages..." << std::endl;

    // 私聊未读
    std::string direct_body = "{\"limit\":50}";
    std::string direct_response = http_post_json(DIRECT_UNREAD_PATH, direct_body, token);
    if (!direct_response.empty()) {
        // 简单打印消息数量（可扩展解析 messages 数组）
        std::cout << "Direct unread response: " << direct_response << std::endl;
    }

    // 群聊未读
    std::string groups_body = "{\"limit\":50}";
    std::string groups_response = http_post_json(GROUPS_UNREAD_PATH, groups_body, token);
    if (!groups_response.empty()) {
        std::cout << "Groups unread response: " << groups_response << std::endl;
    }
}

// ---------- 主函数 ----------
int main() {
    std::string token, sid;

    // 1. 登录
    if (!http_login(USERNAME, PASSWORD, token, sid)) {
        std::cerr << "Login failed, exiting." << std::endl;
        return 1;
    }

    // 2. 进入轮询循环
    std::cout << "Starting polling every " << POLL_INTERVAL_SECONDS << " seconds. Press Ctrl+C to stop." << std::endl;
    while (true) {
        poll_unread(token);
        std::this_thread::sleep_for(std::chrono::seconds(POLL_INTERVAL_SECONDS));
    }

    return 0;
}