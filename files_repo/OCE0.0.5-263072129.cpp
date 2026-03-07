/*------------------------------------------------------------
.###..#.....####......###..#...#..###..#####
#...#.#.....#...#....#...#.#...#.#...#...#..
#...#.#.....#...#....#.....#####.#####...#..
#...#.#.....#...#....#...#.#...#.#...#...#..
.###..#####.####......###..#...#.#...#...#..

Old Chat C++ Edition Version 0.0.5-GUI
Build 20260307-2122
Compiled with WINGW-WIN64 G++ 11.5.0
Made By Fridge3403
Contact us with following address:
1557226951@qq.com

The software copyright belongs to the original developer mcl0.

------------------------------------------------------------*/
#include <iostream>
#include <string>
#include <cstring>
#include <sstream>
#include <thread>
#include <mutex>
#include <queue>
#include <atomic>
#include <vector>
#include <winsock2.h>
#include <windows.h>
#include <ege.h>          // EGE图形库主头文件

#pragma comment(lib, "ws2_32.lib")

using namespace std;
using namespace ege;

// ==================== 用户配置（登录时也可手动输入）====================
string g_username = "username";
string g_password = "userpasswd";
string g_device_id = "OldChat C++ Edition V0.0.5";
string g_device_name = "Windows11";
string g_platform = "Windows MINGW64";
string g_app_version = "0.0.5";

// 全局token和sid（登录成功后更新）
string g_token;
string g_sid;  // 用户ID，用于refresh等

// 服务器信息
const string SERVER_IP = "60.205.94.101";
const int SERVER_PORT = 8080;
const string LOGIN_PATH = "/v1/auth/login";
const string DIRECT_UNREAD_PATH = "/v1/direct/unread";
const string GROUPS_UNREAD_PATH = "/v1/groups/unread";
const string DIRECT_SEND_PATH = "/v1/direct/send";
const string GROUP_SEND_PATH = "/v1/groups/message/send";

// 线程安全的消息队列，用于主线程更新日志
mutex g_logMutex;
queue<string> g_logQueue;
atomic<bool> g_running{true};

// 日志显示区域参数
const int LOG_X = 10, LOG_Y = 300, LOG_WIDTH = 780, LOG_HEIGHT = 280;
const int LOG_LINE_HEIGHT = 16;
vector<string> g_logLines;  // 保存最多显示的日志行

// 向日志队列添加消息（可由工作线程调用）
void logMessage(const string& msg) {
	lock_guard<mutex> lock(g_logMutex);
	g_logQueue.push(msg);
}

// ---------- 通用HTTP POST函数（同前）----------
string http_post_json(const string& path, const string& json_body, const string& token = "") {
	SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
	if (sock == INVALID_SOCKET) {
		return "";
	}
	
	sockaddr_in server_addr;
	server_addr.sin_family = AF_INET;
	server_addr.sin_port = htons(SERVER_PORT);
	server_addr.sin_addr.s_addr = inet_addr(SERVER_IP.c_str());
	if (server_addr.sin_addr.s_addr == INADDR_NONE) {
		closesocket(sock);
		return "";
	}
	
	if (connect(sock, (sockaddr*)&server_addr, sizeof(server_addr)) == SOCKET_ERROR) {
		closesocket(sock);
		return "";
	}
	
	ostringstream request_stream;
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
	string http_request = request_stream.str();
	
	send(sock, http_request.c_str(), http_request.length(), 0);
	
	char recv_buf[8192];
	string response;
	int result;
	do {
		memset(recv_buf, 0, sizeof(recv_buf));
		result = recv(sock, recv_buf, sizeof(recv_buf) - 1, 0);
		if (result > 0) {
			response.append(recv_buf, result);
		}
	} while (result > 0);
	
	closesocket(sock);
	
	if (response.find("200 OK") == string::npos) {
		return "";
	}
	
	size_t body_start = response.find("\r\n\r\n");
	if (body_start == string::npos) return "";
	return response.substr(body_start + 4);
}

// ---------- 简单的JSON字段提取（同前）----------
string extract_json_string(const string& json, const string& key) {
	string search = "\"" + key + "\":\"";
	size_t pos = json.find(search);
	if (pos == string::npos) return "";
	pos += search.length();
	size_t end = json.find("\"", pos);
	if (end == string::npos) return "";
	return json.substr(pos, end - pos);
}

string extract_nested_string(const string& json, const string& outer, const string& inner) {
	string outer_search = "\"" + outer + "\":{";
	size_t outer_start = json.find(outer_search);
	if (outer_start == string::npos) return "";
	outer_start += outer_search.length();
	int brace_level = 1;
	size_t outer_end = outer_start;
	while (outer_end < json.length() && brace_level > 0) {
		if (json[outer_end] == '{') brace_level++;
		else if (json[outer_end] == '}') brace_level--;
		outer_end++;
	}
	string outer_content = json.substr(outer_start, outer_end - outer_start - 1);
	return extract_json_string(outer_content, inner);
}

// ---------- 登录函数（返回是否成功，并设置g_token和g_sid）----------
bool http_login(const string& username, const string& password) {
	string json_body = "{"
	"\"identifier\":\"" + username + "\","
	"\"password\":\"" + password + "\","
	"\"device_id\":\"" + g_device_id + "\","
	"\"device_name\":\"" + g_device_name + "\","
	"\"platform\":\"" + g_platform + "\","
	"\"app_version\":\"" + g_app_version + "\""
	"}";
	
	string resp_body = http_post_json(LOGIN_PATH, json_body, "");
	if (resp_body.empty()) return false;
	
	string token = extract_json_string(resp_body, "access_token");
	string sid = extract_nested_string(resp_body, "user", "id");
	if (token.empty() || sid.empty()) return false;
	
	g_token = token;
	g_sid = sid;
	return true;
}

// ---------- 工作线程函数：登录 ----------
void thread_login(const string& username, const string& password) {
	bool ok = http_login(username, password);
	if (ok) {
		logMessage("[Login] Success. Token: " + g_token.substr(0,20) + "...");
	} else {
		logMessage("[Login] Failed.");
	}
}

// ---------- 工作线程函数：发送群消息 ----------
void thread_send_group(const string& group_id, const string& body) {
	if (g_token.empty()) {
		logMessage("[Group] Not logged in.");
		return;
	}
	string json_body = "{"
	"\"group_id\":\"" + group_id + "\","
	"\"body\":\"" + body + "\","
	"\"msg_type\":\"text\","
	"\"burn_after_seconds\":0"
	"}";
	string resp = http_post_json(GROUP_SEND_PATH, json_body, g_token);
	if (!resp.empty()) {
		logMessage("[Group] Message sent. Response: " + resp);
	} else {
		logMessage("[Group] Send failed.");
	}
}

// ---------- 工作线程函数：发送私聊消息 ----------
void thread_send_direct(const string& to_uid, const string& body) {
	if (g_token.empty()) {
		logMessage("[Direct] Not logged in.");
		return;
	}
	string json_body = "{"
	"\"to_uid\":\"" + to_uid + "\","
	"\"body\":\"" + body + "\","
	"\"msg_type\":\"text\","
	"\"burn_after_seconds\":0"
	"}";
	string resp = http_post_json(DIRECT_SEND_PATH, json_body, g_token);
	if (!resp.empty()) {
		logMessage("[Direct] Message sent. Response: " + resp);
	} else {
		logMessage("[Direct] Send failed.");
	}
}

// ---------- 工作线程函数：刷新未读消息（仅显示计数）----------
void thread_refresh() {
	if (g_token.empty()) {
		logMessage("[Refresh] Not logged in.");
		return;
	}
	logMessage("[Refresh] Fetching unread...");
	string direct_body = "{\"limit\":50}";
	string direct_resp = http_post_json(DIRECT_UNREAD_PATH, direct_body, g_token);
	string groups_body = "{\"limit\":50}";
	string groups_resp = http_post_json(GROUPS_UNREAD_PATH, groups_body, g_token);
	
	auto count_messages = [](const string& json) -> int {
		size_t pos = json.find("\"messages\":[");
		if (pos == string::npos) return -1;
		int cnt = 0;
		size_t i = pos + 11;
		while (i < json.length() && json[i] != ']') {
			if (json[i] == '{') {
				cnt++;
				int level = 1;
				i++;
				while (i < json.length() && level > 0) {
					if (json[i] == '{') level++;
					else if (json[i] == '}') level--;
					i++;
				}
			} else {
				i++;
			}
		}
		return cnt;
	};
	
	int direct_cnt = direct_resp.empty() ? -1 : count_messages(direct_resp);
	int groups_cnt = groups_resp.empty() ? -1 : count_messages(groups_resp);
	
	if (direct_cnt >= 0) {
		logMessage("[Refresh] Direct unread: " + to_string(direct_cnt) + " messages");
	} else {
		logMessage("[Refresh] Direct unread: (error)");
	}
	if (groups_cnt >= 0) {
		logMessage("[Refresh] Group unread: " + to_string(groups_cnt) + " messages");
	} else {
		logMessage("[Refresh] Group unread: (error)");
	}
}

// ---------- 界面元素坐标 ----------
struct Button {
	int x, y, w, h;
	string label;
};

// 定义按钮
Button btnLogin = {10, 10, 80, 30, "Login"};
Button btnRefresh = {100, 10, 100, 30, "Refresh"};
Button btnRelogin = {210, 10, 80, 30, "Relogin"};

Button btnGroupSend = {10, 60, 120, 30, "Send Group"};
Button btnDirectSend = {140, 60, 120, 30, "Send Direct"};
Button btnAbout = {300, 10, 80, 30, "About"};

// 日志区域已定义常量

// 检查鼠标是否在按钮内
bool isMouseInButton(int mx, int my, const Button& btn) {
	return mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h;
}

// 绘制按钮
void drawButton(const Button& btn, bool hover, string abcd) {
	setfillcolor(hover ? EGERGB(200,200,255) : EGERGB(220,220,220));
	setcolor(EGERGB(0,0,0));
	bar(btn.x, btn.y, btn.x + btn.w, btn.y + btn.h);
	rectangle(btn.x, btn.y, btn.x + btn.w, btn.y + btn.h);
	settextcolor(EGERGB(0xff,0x00,0xff));
	outtextxy(btn.x + 5, btn.y + 8, abcd.c_str());
}

// 绘制日志区域
void drawLogArea() {
	setfillcolor(EGERGB(240,240,240));
	setcolor(EGERGB(0,0,0));
	bar(LOG_X, LOG_Y, LOG_X + LOG_WIDTH, LOG_Y + LOG_HEIGHT);
	rectangle(LOG_X, LOG_Y, LOG_X + LOG_WIDTH, LOG_Y + LOG_HEIGHT);
	// 显示最近日志
	int lineY = LOG_Y + 5;
	settextcolor(EGERGB(0xff,0xff,0xff));
	for (size_t i = 0; i < g_logLines.size(); i++) {
		outtextxy(LOG_X + 5, lineY, g_logLines[i].c_str());
		lineY += LOG_LINE_HEIGHT;
		if (lineY > LOG_Y + LOG_HEIGHT - LOG_LINE_HEIGHT) break;
	}
}

// 更新日志行（从队列中取出并追加）
void updateLogLines() {
	lock_guard<mutex> lock(g_logMutex);
	while (!g_logQueue.empty()) {
		string msg = g_logQueue.front();
		g_logQueue.pop();
		g_logLines.push_back(msg);
		// 限制行数，防止溢出
		if (g_logLines.size() > (LOG_HEIGHT / LOG_LINE_HEIGHT)) {
			g_logLines.erase(g_logLines.begin());
		}
	}
}

// ---------- 主函数 ----------
int main() {
	// 初始化WinSock
	WSADATA wsaData;
	if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
		MessageBox(NULL, "WSAStartup failed", "Error", MB_OK);
		return 1;
	}
	
	// 初始化EGE图形窗口
	initgraph(800, 600, 0);
	setcaption("OldChat GUI Client (EGE)");
	setrendermode(RENDER_MANUAL);
	// 设置字体（使用系统默认字体，英文）
	setfont(16, 0, "Arial");
	settextcolor(EGERGB(0x00,0xf0,0xff));
	
	// 鼠标变量
	mouse_msg mouse = {0};
	int lastMouseX = 0, lastMouseY = 0;
	bool hoverLogin = false, hoverRefresh = false, hoverRelogin = false,
	hoverGroup = false, hoverDirect = false, hoverAbout = false;;
	
	// 主循环
	while (is_run()) {
		// 处理鼠标消息
		while (mousemsg()) {
			mouse = getmouse();
			lastMouseX = mouse.x;
			lastMouseY = mouse.y;
			
			// 更新悬停状态
			hoverLogin = isMouseInButton(lastMouseX, lastMouseY, btnLogin);
			hoverRefresh = isMouseInButton(lastMouseX, lastMouseY, btnRefresh);
			hoverRelogin = isMouseInButton(lastMouseX, lastMouseY, btnRelogin);
			hoverGroup = isMouseInButton(lastMouseX, lastMouseY, btnGroupSend);
			hoverDirect = isMouseInButton(lastMouseX, lastMouseY, btnDirectSend);
			hoverAbout = isMouseInButton(lastMouseX, lastMouseY, btnAbout);
			
			// 处理点击
			if (mouse.is_left() && mouse.is_down()) {
				if (hoverLogin) {
					// 弹出输入框获取用户名密码
					char user[256] = "", pass[256] = "";
					inputbox_getline("Login", "Username:", user, 256);
					inputbox_getline("Login", "Password:", pass, 256);
					if (strlen(user) > 0 && strlen(pass) > 0) {
						thread(thread_login, string(user), string(pass)).detach();
					}
				}
				else if (hoverRefresh) {
					thread(thread_refresh).detach();
				}
				else if (hoverRelogin) {
					char user[256] = "", pass[256] = "";
					inputbox_getline("Re-login", "Username:", user, 256);
					inputbox_getline("Re-login", "Password:", pass, 256);
					if (strlen(user) > 0 && strlen(pass) > 0) {
						thread(thread_login, string(user), string(pass)).detach();
					}
				}
				else if (hoverGroup) {
					char group_id[256] = "", msg[1024] = "";
					inputbox_getline("Group Message", "Group ID:", group_id, 256);
					inputbox_getline("Group Message", "Message:", msg, 1024);
					if (strlen(group_id) > 0 && strlen(msg) > 0) {
						thread(thread_send_group, string(group_id), string(msg)).detach();
					}
				}
				else if (hoverDirect) {
					char to_uid[256] = "", msg[1024] = "";
					inputbox_getline("Direct Message", "To UID:", to_uid, 256);
					inputbox_getline("Direct Message", "Message:", msg, 1024);
					if (strlen(to_uid) > 0 && strlen(msg) > 0) {
						thread(thread_send_direct, string(to_uid), string(msg)).detach();
					}
				}else if (hoverAbout) {    // 新增
					MessageBoxA(NULL, 
								"OldChat C++ Edition V0.0.5-GUI\n"
								"Compiled with MINGW-WIN64\n"
								"Made by Fridge3403\n"
								"Contact us with the following address:\n"
								"1557226951@qq.com",
								"About", MB_OK);
				}
			}
		}
		
		// 更新日志行（从队列中取）
		updateLogLines();
		
		// 绘制界面
		cleardevice();
		
		// 绘制按钮
		drawButton(btnLogin, hoverLogin, "LOGIN");
		drawButton(btnRefresh, hoverRefresh, "REFRESH");
		drawButton(btnRelogin, hoverRelogin, "RELOGIN");
		drawButton(btnGroupSend, hoverGroup, "GRPSEND");
		drawButton(btnDirectSend, hoverDirect, "USRSEND");
		drawButton(btnAbout, hoverAbout, "ABOUT");
		// 绘制日志区域
		drawLogArea();
		flushwindow();
		
		// 延迟
		delay_fps(60);
	}
	
	closegraph();
	WSACleanup();
	return 0;
}
