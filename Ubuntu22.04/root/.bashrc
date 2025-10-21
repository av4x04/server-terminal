# Custom bash configuration for admin@client

# Màu đỏ cho prompt admin@client
RED='\[\e[0;31m\]'
RESET='\[\e[0m\]'
export PS1="${RED}admin@client${RESET}:~# "

# Chặn Ctrl+D - yêu cầu phải bấm Ctrl+D rất nhiều lần mới thoát được
set -o ignoreeof
export IGNOREEOF=999

# Vô hiệu hóa các builtin commands nguy hiểm
enable -n exit 2>/dev/null
enable -n logout 2>/dev/null
enable -n exec 2>/dev/null
enable -n source 2>/dev/null

# Tạo alias cho tất cả các escape vectors
alias exit='echo "Lệnh \"exit\" đã bị vô hiệu hóa. Không thể thoát khỏi shell này."'
alias logout='echo "Lệnh \"logout\" đã bị vô hiệu hóa. Không thể thoát khỏi shell này."'
alias builtin='echo "Lệnh \"builtin\" đã bị vô hiệu hóa trong shell này."'
alias command='echo "Lệnh \"command\" đã bị vô hiệu hóa trong shell này."'
alias enable='echo "Lệnh \"enable\" đã bị vô hiệu hóa trong shell này."'
alias exec='echo "Lệnh \"exec\" đã bị vô hiệu hóa trong shell này."'
alias source='echo "Lệnh \"source\" đã bị vô hiệu hóa trong shell này."'
alias .='echo "Lệnh \".\" (source) đã bị vô hiệu hóa trong shell này."'

# Chặn spawn shell mới
alias bash='echo "Không thể spawn shell mới. Lệnh \"bash\" đã bị vô hiệu hóa."'
alias sh='echo "Không thể spawn shell mới. Lệnh \"sh\" đã bị vô hiệu hóa."'
alias dash='echo "Không thể spawn shell mới. Lệnh \"dash\" đã bị vô hiệu hóa."'

# Vô hiệu hóa các lệnh system
alias reboot='echo "Lệnh \"reboot\" đã bị vô hiệu hóa trong môi trường này."'
alias poweroff='echo "Lệnh \"poweroff\" đã bị vô hiệu hóa trong môi trường này."'
alias shutdown='echo "Lệnh \"shutdown\" đã bị vô hiệu hóa trong môi trường này."'
alias halt='echo "Lệnh \"halt\" đã bị vô hiệu hóa trong môi trường này."'

# Chặn kill commands để bảo vệ parent process
alias kill='echo "Lệnh \"kill\" đã bị vô hiệu hóa. Không thể kill process."'
alias killall='echo "Lệnh \"killall\" đã bị vô hiệu hóa. Không thể kill process."'
alias pkill='echo "Lệnh \"pkill\" đã bị vô hiệu hóa. Không thể kill process."'
alias ps='echo "Lệnh \"ps\" đã bị vô hiệu hóa để bảo vệ hệ thống."'

# Tạo function để override và trap các lệnh
function exit() {
    echo "Lệnh 'exit' đã bị vô hiệu hóa. Không thể thoát khỏi shell này."
}

function logout() {
    echo "Lệnh 'logout' đã bị vô hiệu hóa. Không thể thoát khỏi shell này."
}

function exec() {
    echo "Lệnh 'exec' đã bị vô hiệu hóa. Không thể spawn shell mới."
}

function builtin() {
    echo "Lệnh 'builtin' đã bị vô hiệu hóa trong shell này."
}

function command() {
    echo "Lệnh 'command' đã bị vô hiệu hóa trong shell này."
}

function enable() {
    echo "Lệnh 'enable' đã bị vô hiệu hóa trong shell này."
}

# Export các function
export -f exit
export -f logout
export -f exec
export -f builtin
export -f command
export -f enable

# Trap DEBUG để chặn tất cả command nguy hiểm trước khi chạy
function __trap_debug_command() {
    local cmd="${BASH_COMMAND}"
    
    # Chặn kill commands (bất kỳ variant nào)
    if [[ "$cmd" =~ kill || "$cmd" =~ pkill || "$cmd" =~ killall ]]; then
        echo "⚠️  Lệnh kill đã bị chặn để bảo vệ shell chính."
        return 1
    fi
    
    # Chặn full path shell spawning
    if [[ "$cmd" =~ bash || "$cmd" =~ [[:space:]]sh[[:space:]] || "$cmd" =~ ^sh$ || "$cmd" =~ dash ]]; then
        echo "⚠️  Không thể spawn shell mới. Lệnh đã bị chặn."
        return 1
    fi
    
    # Chặn env command
    if [[ "$cmd" =~ ^[[:space:]]*env ]]; then
        echo "⚠️  Lệnh env đã bị chặn để bảo vệ shell."
        return 1
    fi
    
    return 0
}

# Set trap DEBUG để check mọi command trước khi chạy
trap '__trap_debug_command' DEBUG

# Readonly các biến quan trọng để không thể unset
readonly PROMPT_COMMAND 2>/dev/null
readonly BASH_ENV 2>/dev/null

# Hardening PATH - chỉ allow safe commands
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Message chào mừng
echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║                                                    ║"
echo "║     Chào mừng đến với Admin Client Terminal       ║"
echo "║          Shell này đã được bảo vệ                 ║"
echo "║                                                    ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

