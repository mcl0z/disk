// pc98emu_fix_access.cpp - 修复访问违规的PC-98模拟器
// 编译: g++ -O2 -m32 pc98emu_fix_access.cpp -o pc98emu.exe -lgraphics -luuid -lmsimg32 -lgdi32 -limm32 -lole32 -loleaut32

#include <graphics.h>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <windows.h>
#include <vector>
#include <string>
#include <algorithm>
#include <map>
#include <io.h>
#include <set>
#pragma comment(lib, "winmm.lib")

// ==================== 配置 ====================
#define MAX_MEMORY  (1024 * 1024)   // 1MB内存
#define VRAM_OFFSET  0xB8000        // 文本VRAM地址
#define MAX_GAME_SIZE 65535         // 最大游戏大小64KB

// ==================== 安全的CPU仿真器 ====================
class Safe8086 {
private:
    // 内存 (1MB)
    uint8_t* memory;
    
    // 访问追踪
    std::set<uint32_t> accessed_pages;
    bool debug_mode;
    
public:
    // 寄存器
    uint16_t ax, bx, cx, dx, si, di, bp, sp, ip, flags;
    uint16_t cs, ds, es, ss;
    
    // 运行状态
    bool running;
    bool halted;
    bool interrupt_enabled;
    
    // 视频内存指针
    uint8_t* vram;
    
    // 键盘缓冲
    uint8_t key_buffer[32];
    uint8_t key_head, key_tail;
    
    // 统计
    uint64_t total_instructions;
    uint64_t total_cycles;
    int error_count;
    
    Safe8086() {
        memory = new uint8_t[MAX_MEMORY];
        memset(memory, 0, MAX_MEMORY);
        
        reset();
        debug_mode = false;
    }
    
    ~Safe8086() {
        delete[] memory;
    }
    
    void reset() {
        ax = bx = cx = dx = si = di = bp = 0;
        ip = 0x0100;  // COM文件从0100h开始
        cs = 0x0000;
        ds = 0x0000;
        es = 0x0000;
        ss = 0x0000;
        sp = 0xFFFE;  // 堆栈顶端
        flags = 0x0202;  // 中断使能
        running = false;
        halted = false;
        interrupt_enabled = true;
        vram = memory + VRAM_OFFSET;
        key_head = 0;
        key_tail = 0;
        total_instructions = 0;
        total_cycles = 0;
        error_count = 0;
        
        // 清空访问追踪
        accessed_pages.clear();
    }
    
    // 安全的内存访问函数
    bool check_address(uint32_t addr) {
        if (addr >= MAX_MEMORY) {
            if (debug_mode) {
                printf("内存访问越界: %08X (最大: %08X)\n", addr, MAX_MEMORY);
            }
            return false;
        }
        return true;
    }
    
    uint8_t read8(uint32_t addr) {
        if (!check_address(addr)) return 0xFF;
        
        // 记录访问
        accessed_pages.insert(addr >> 12);
        return memory[addr];
    }
    
    uint16_t read16(uint32_t addr) {
        if (!check_address(addr) || !check_address(addr + 1)) return 0xFFFF;
        return read8(addr) | (read8(addr + 1) << 8);
    }
    
    void write8(uint32_t addr, uint8_t value) {
        if (!check_address(addr)) return;
        
        // 记录访问
        accessed_pages.insert(addr >> 12);
        memory[addr] = value;
    }
    
    void write16(uint32_t addr, uint16_t value) {
        write8(addr, value & 0xFF);
        write8(addr + 1, value >> 8);
    }
    
    uint32_t get_linear(uint16_t seg, uint16_t offset) {
        uint32_t addr = (seg << 4) + offset;
        
        // 防止回绕 (8086只有20位地址线)
        if (addr > 0xFFFFF) {
            addr = (addr & 0xFFFF) + ((seg & 0xF000) << 4);
        }
        
        return addr;
    }
    
    void push16(uint16_t value) {
        if (sp < 2) {
            if (debug_mode) printf("堆栈下溢! SP=%04X\n", sp);
            halted = true;
            return;
        }
        
        sp -= 2;
        write16(get_linear(ss, sp), value);
    }
    
    uint16_t pop16() {
        if (sp > 0xFFFD) {
            if (debug_mode) printf("堆栈上溢! SP=%04X\n", sp);
            halted = true;
            return 0;
        }
        
        uint16_t value = read16(get_linear(ss, sp));
        sp += 2;
        return value;
    }
    
    void load_com(const uint8_t* data, uint32_t size) {
        if (size > MAX_GAME_SIZE) {
            size = MAX_GAME_SIZE;
        }
        
        // 清空内存区域
        memset(memory, 0, MAX_MEMORY);
        
        // 复制程序到0100h
        for (uint32_t i = 0; i < size; i++) {
            write8(0x0100 + i, data[i]);
        }
        
        // 设置PSP (程序段前缀)
        write8(0x0000, 0xCD);  // INT 20h
        write8(0x0001, 0x20);
        write8(0x0002, 0x00);  // 程序结束地址
        write8(0x0003, 0x01);
        
        // 创建简单的BIOS/DOS服务
        create_bios_services();
        
        reset();
        running = true;
    }
    
    void create_bios_services() {
        // 创建空的中断向量表
        for (int i = 0; i < 256; i++) {
            write16(i * 4, 0xF000);    // 默认指向F000段
            write16(i * 4 + 2, 0xF000);
        }
        
        // INT 21h 处理程序 - 简单的DOS服务
        uint8_t int21h[] = {
            // INT 21h入口
            0x80, 0xFC, 0x09,       // CMP AH,09h
            0x74, 0x10,             // JZ display_string
            0x80, 0xFC, 0x4C,       // CMP AH,4Ch
            0x74, 0x1A,             // JZ terminate
            0x80, 0xFC, 0x02,       // CMP AH,02h
            0x74, 0x06,             // JZ display_char
            // 默认处理
            0xB8, 0x00, 0x00,       // MOV AX,0000h
            0xCF,                   // IRET
            
            // 显示字符 (AH=02h)
            0x50,                   // PUSH AX
            0xB4, 0x0E,             // MOV AH,0Eh
            0xCD, 0x10,             // INT 10h
            0x58,                   // POP AX
            0xCF,                   // IRET
            
            // 显示字符串 (AH=09h)
            0x53,                   // PUSH BX
            0x51,                   // PUSH CX
            .loop:
            0x8A, 0x17,             // MOV DL,[BX]
            0x80, 0xFA, 0x24,       // CMP DL,'$'
            0x74, 0x08,             // JZ .done
            0xB4, 0x02,             // MOV AH,02h
            0xCD, 0x21,             // INT 21h
            0x43,                   // INC BX
            0xEB, 0xF1,             // JMP .loop
            .done:
            0x59,                   // POP CX
            0x5B,                   // POP BX
            0xCF,                   // IRET
            
            // 程序终止 (AH=4Ch)
            0xB4, 0x4C,             // MOV AH,4Ch
            0xCD, 0x21,             // INT 21h (递归调用)
            0xCF                    // IRET
        };
        
        for (size_t i = 0; i < sizeof(int21h); i++) {
            write8(0xF2100 + i, int21h[i]);
        }
        
        // INT 10h 处理程序 - 视频服务
        uint8_t int10h[] = {
            // INT 10h入口
            0x80, 0xFC, 0x0E,       // CMP AH,0Eh
            0x74, 0x03,             // JZ display_char
            0xCF,                   // IRET
            
            // 显示字符 (AH=0Eh)
            0x50,                   // PUSH AX
            0x53,                   // PUSH BX
            // 将字符写入VRAM
            0xB8, 0x00, 0xB8,       // MOV AX,0B800h
            0x8E, 0xC0,             // MOV ES,AX
            0x31, 0xFF,             // XOR DI,DI
            0x88, 0xC4,             // MOV AH,AL
            0xB0, 0x07,             // MOV AL,07h
            0xAB,                   // STOSW
            0x5B,                   // POP BX
            0x58,                   // POP AX
            0xCF                    // IRET
        };
        
        for (size_t i = 0; i < sizeof(int10h); i++) {
            write8(0xF2000 + i, int10h[i]);
        }
        
        // INT 20h 处理程序 - 程序终止
        write8(0xF3000, 0xB4);      // MOV AH,4Ch
        write8(0xF3001, 0x4C);
        write8(0xF3002, 0xCD);      // INT 21h
        write8(0xF3003, 0x21);
        write8(0xF3004, 0xCF);      // IRET
    }
    
    void queue_key(uint8_t key) {
        uint8_t next_tail = (key_tail + 1) % 32;
        if (next_tail != key_head) {
            key_buffer[key_tail] = key;
            key_tail = next_tail;
        }
    }
    
    uint8_t dequeue_key() {
        if (key_head == key_tail) return 0;
        uint8_t key = key_buffer[key_head];
        key_head = (key_head + 1) % 32;
        return key;
    }
    
    bool has_key() {
        return key_head != key_tail;
    }
    
    // 执行一个指令（安全版本）
    bool execute_one() {
        if (!running || halted) return false;
        
        // 检查IP是否越界
        uint32_t linear_ip = get_linear(cs, ip);
        if (!check_address(linear_ip)) {
            halted = true;
            if (debug_mode) printf("IP越界: CS:IP=%04X:%04X\n", cs, ip);
            return false;
        }
        
        // 读取指令
        uint8_t opcode = read8(linear_ip);
        ip++;
        
        total_instructions++;
        
        // 简单指令解码（只实现最常用的指令）
        switch(opcode) {
            // NOP
            case 0x90:
                break;
                
            // MOV reg8, imm8
            case 0xB0: ax = (ax & 0xFF00) | read8_safe(cs, ip++); break;
            case 0xB1: cx = (cx & 0xFF00) | read8_safe(cs, ip++); break;
            case 0xB2: dx = (dx & 0xFF00) | read8_safe(cs, ip++); break;
            case 0xB3: bx = (bx & 0xFF00) | read8_safe(cs, ip++); break;
            case 0xB4: ax = (ax & 0x00FF) | (read8_safe(cs, ip++) << 8); break;
            case 0xB5: cx = (cx & 0x00FF) | (read8_safe(cs, ip++) << 8); break;
            case 0xB6: dx = (dx & 0x00FF) | (read8_safe(cs, ip++) << 8); break;
            case 0xB7: bx = (bx & 0x00FF) | (read8_safe(cs, ip++) << 8); break;
            
            // MOV reg16, imm16
            case 0xB8: ax = read16_safe(cs, ip); ip += 2; break;
            case 0xB9: cx = read16_safe(cs, ip); ip += 2; break;
            case 0xBA: dx = read16_safe(cs, ip); ip += 2; break;
            case 0xBB: bx = read16_safe(cs, ip); ip += 2; break;
            case 0xBC: sp = read16_safe(cs, ip); ip += 2; break;
            case 0xBD: bp = read16_safe(cs, ip); ip += 2; break;
            case 0xBE: si = read16_safe(cs, ip); ip += 2; break;
            case 0xBF: di = read16_safe(cs, ip); ip += 2; break;
            
            // CMP AL, imm8
            case 0x3C: {
                uint8_t imm = read8_safe(cs, ip++);
                uint8_t result = (ax & 0xFF) - imm;
                flags = (flags & ~0x0040) | ((result == 0) ? 0x0040 : 0);
                break;
            }
            
            // INT
            case 0xCD: {
                uint8_t int_num = read8_safe(cs, ip++);
                if (interrupt_enabled) {
                    handle_interrupt(int_num);
                }
                break;
            }
            
            // IRET
            case 0xCF:
                flags = pop16();
                ip = pop16();
                cs = pop16();
                break;
                
            // RET
            case 0xC3:
                ip = pop16();
                break;
                
            // RETF (far return)
            case 0xCB:
                ip = pop16();
                cs = pop16();
                break;
                
            // PUSH reg
            case 0x50: push16(ax); break;
            case 0x51: push16(cx); break;
            case 0x52: push16(dx); break;
            case 0x53: push16(bx); break;
            case 0x54: push16(sp); break;
            case 0x55: push16(bp); break;
            case 0x56: push16(si); break;
            case 0x57: push16(di); break;
            
            // POP reg
            case 0x58: ax = pop16(); break;
            case 0x59: cx = pop16(); break;
            case 0x5A: dx = pop16(); break;
            case 0x5B: bx = pop16(); break;
            case 0x5C: sp = pop16(); break;
            case 0x5D: bp = pop16(); break;
            case 0x5E: si = pop16(); break;
            case 0x5F: di = pop16(); break;
            
            // JMP short
            case 0xEB: {
                int8_t offset = (int8_t)read8_safe(cs, ip++);
                ip += offset;
                break;
            }
            
            // JMP near
            case 0xE9: {
                int16_t offset = (int16_t)read16_safe(cs, ip);
                ip += 2;
                ip += offset;
                break;
            }
            
            // JZ/JE short
            case 0x74: {
                int8_t offset = (int8_t)read8_safe(cs, ip++);
                if (flags & 0x0040) {  // ZF set
                    ip += offset;
                }
                break;
            }
            
            // JNZ/JNE short
            case 0x75: {
                int8_t offset = (int8_t)read8_safe(cs, ip++);
                if (!(flags & 0x0040)) {  // ZF not set
                    ip += offset;
                }
                break;
            }
            
            // CALL near
            case 0xE8: {
                int16_t offset = (int16_t)read16_safe(cs, ip);
                ip += 2;
                push16(ip);
                ip += offset;
                break;
            }
            
            // HLT
            case 0xF4:
                halted = true;
                break;
                
            // CLI/STI
            case 0xFA: interrupt_enabled = false; break;  // CLI
            case 0xFB: interrupt_enabled = true; break;   // STI
                
            // INC reg16
            case 0x40: ax++; break;
            case 0x41: cx++; break;
            case 0x42: dx++; break;
            case 0x43: bx++; break;
            case 0x44: sp++; break;
            case 0x45: bp++; break;
            case 0x46: si++; break;
            case 0x47: di++; break;
            
            // DEC reg16
            case 0x48: ax--; break;
            case 0x49: cx--; break;
            case 0x4A: dx--; break;
            case 0x4B: bx--; break;
            case 0x4C: sp--; break;
            case 0x4D: bp--; break;
            case 0x4E: si--; break;
            case 0x4F: di--; break;
            
            // XOR reg, reg
            case 0x31: case 0x33: {
                // 简化处理 - 跳过modr/m字节
                ip++;
                break;
            }
            
            // TEST reg, reg
            case 0x85: {
                // 简化处理 - 跳过modr/m字节
                ip++;
                break;
            }
            
            // LOOP
            case 0xE2: {
                int8_t offset = (int8_t)read8_safe(cs, ip++);
                cx--;
                if (cx != 0) {
                    ip += offset;
                }
                break;
            }
            
            // LOOPNZ/LOOPNE
            case 0xE0: {
                int8_t offset = (int8_t)read8_safe(cs, ip++);
                cx--;
                if (cx != 0 && !(flags & 0x0040)) {
                    ip += offset;
                }
                break;
            }
            
            // LOOPZ/LOOPE
            case 0xE1: {
                int8_t offset = (int8_t)read8_safe(cs, ip++);
                cx--;
                if (cx != 0 && (flags & 0x0040)) {
                    ip += offset;
                }
                break;
            }
            
            // IN/OUT (简单模拟)
            case 0xE4: case 0xE5: case 0xE6: case 0xE7: {
                // 跳过端口号
                ip++;
                break;
            }
            
            default:
                // 未知指令 - 记录错误
                error_count++;
                if (debug_mode) {
                    printf("未知指令: %02X at %04X:%04X\n", opcode, cs, ip-1);
                }
                
                // 如果错误太多，停止执行
                if (error_count > 100) {
                    halted = true;
                    if (debug_mode) {
                        printf("错误太多，停止执行\n");
                    }
                }
                break;
        }
        
        total_cycles++;
        return true;
    }
    
private:
    uint8_t read8_safe(uint16_t seg, uint16_t offset) {
        uint32_t addr = get_linear(seg, offset);
        if (!check_address(addr)) return 0xFF;
        return read8(addr);
    }
    
    uint16_t read16_safe(uint16_t seg, uint16_t offset) {
        uint32_t addr = get_linear(seg, offset);
        if (!check_address(addr) || !check_address(addr + 1)) return 0xFFFF;
        return read8(addr) | (read8(addr + 1) << 8);
    }
    
    void handle_interrupt(uint8_t int_num) {
        // 保存返回地址和标志
        push16(cs);
        push16(ip);
        push16(flags);
        
        // 禁用中断
        interrupt_enabled = false;
        
        // 跳转到中断处理程序（简化处理）
        switch(int_num) {
            case 0x20: // 程序终止
            case 0x21: // DOS服务
            case 0x27: // 终止驻留
                halted = true;
                break;
                
            default:
                // 跳转到默认处理程序
                cs = 0xF000;
                ip = int_num * 0x100;
                break;
        }
    }
};

// ==================== 简化的游戏管理器 ====================
class SimpleGameManager {
private:
    Safe8086 cpu;
    bool game_loaded;
    std::vector<std::string> screen_buffer;
    int screen_width, screen_height;
    
public:
    SimpleGameManager() : game_loaded(false), screen_width(80), screen_height(25) {}
    
    bool load_game(uint8_t* data, uint32_t size, const char* name) {
        printf("加载游戏: %s (%u 字节)\n", name, size);
        
        // 检查是否是有效的COM文件（前几个字节）
        if (size < 2) {
            printf("文件太小\n");
            return false;
        }
        
        // 检查是否有明显的问题指令
        bool has_problem = false;
        for (uint32_t i = 0; i < std::min(size, 100u); i++) {
            uint8_t opcode = data[i];
            // 检查一些可能导致崩溃的指令模式
            if (opcode == 0x9A || opcode == 0xEA) { // CALL far, JMP far
                printf("警告: 检测到远调用/跳转指令，可能不支持\n");
            }
        }
        
        // 加载游戏
        cpu.load_com(data, size);
        game_loaded = true;
        
        // 初始化屏幕缓冲
        screen_buffer.clear();
        screen_buffer.resize(screen_height, std::string(screen_width, ' '));
        
        printf("游戏加载成功\n");
        return true;
    }
    
    bool is_running() {
        return game_loaded && cpu.running && !cpu.halted;
    }
    
    void run_frame(int cycles = 100) {
        if (!is_running()) return;
        
        // 执行一定数量的指令
        for (int i = 0; i < cycles && is_running(); i++) {
            cpu.execute_one();
            
            // 每1000条指令检查一次
            if (cpu.total_instructions % 1000 == 0) {
                // 防止无限循环
                if (cpu.total_instructions > 100000) {
                    printf("执行指令过多，可能陷入死循环\n");
                    cpu.halted = true;
                    break;
                }
            }
        }
    }
    
    void render(PIMAGE screen, int screen_width, int screen_height) {
        if (!screen || !is_running()) return;
        
        // 清屏
        setcolor(BLACK, screen);
        bar(0, 0, screen_width-1, screen_height-1, screen);
        
        // 显示简单的游戏界面
        setcolor(WHITE, screen);
        outtextxy(100, 50, "游戏正在运行...", screen);
        
        char info[256];
        snprintf(info, sizeof(info), "已执行指令: %llu", cpu.total_instructions);
        outtextxy(100, 80, info, screen);
        
        snprintf(info, sizeof(info), "错误计数: %d", cpu.error_count);
        outtextxy(100, 100, info, screen);
        
        setcolor(YELLOW, screen);
        outtextxy(100, 130, "按ESC键返回DOS", screen);
        
        setcolor(GREEN, screen);
        outtextxy(100, 150, "这是一个安全的仿真环境", screen);
        outtextxy(100, 170, "复杂的游戏可能无法运行", screen);
    }
    
    void stop() {
        game_loaded = false;
        cpu.running = false;
        cpu.halted = true;
    }
};

// ==================== 简化的DOS模拟器 ====================
int main() {
    printf("PC-98 DOS模拟器 - 安全版本\n");
    printf("按任意键开始...\n");
    getchar();
    
    // 初始化EGE
    setinitmode(INIT_RENDERMANUAL);
    initgraph(640, 400);
    if(!is_run()) {
        printf("无法初始化图形\n");
        return 1;
    }
    
    setcaption("PC-98 DOS模拟器 - 安全版本");
    
    PIMAGE screen = newimage(640, 400);
    if(!screen) {
        printf("无法创建屏幕缓冲\n");
        closegraph();
        return 1;
    }
    
    // 创建游戏管理器
    SimpleGameManager game_mgr;
    
    // 模拟一个简单的COM程序
    uint8_t demo_program[] = {
        0xB4, 0x09,       // MOV AH,09h
        0xBA, 0x10, 0x01, // MOV DX,0110h
        0xCD, 0x21,       // INT 21h
        0xB4, 0x4C,       // MOV AH,4Ch
        0xCD, 0x21,       // INT 21h
        // 字符串
        'S','a','f','e',' ','D','O','S',' ','E','m','u','l','a','t','o','r','\r','\n',
        'G','a','m','e',' ','R','u','n','n','i','n','g','.','.','.','\r','\n','$'
    };
    
    // 加载演示程序
    game_mgr.load_game(demo_program, sizeof(demo_program), "DEMO.COM");
    
    bool running = true;
    
    // 主循环
    while (is_run() && running) {
        // 处理键盘
        while (kbmsg()) {
            key_msg k = getkey();
            if (k.msg == key_msg_down && k.key == key_esc) {
                running = false;
                break;
            }
        }
        
        // 运行游戏
        if (game_mgr.is_running()) {
            game_mgr.run_frame(50);
            game_mgr.render(screen, 640, 400);
        } else {
            // 显示结束信息
            setcolor(BLACK, screen);
            bar(0, 0, 639, 399, screen);
            setcolor(WHITE, screen);
            outtextxy(100, 150, "游戏已结束", screen);
            outtextxy(100, 170, "按ESC键退出", screen);
        }
        
        putimage(0, 0, screen);
        delay_fps(30);
    }
    
    // 清理
    delimage(screen);
    closegraph();
    
    printf("模拟器结束\n");
    return 0;
}