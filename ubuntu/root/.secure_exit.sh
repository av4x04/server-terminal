#!/bin/bash

# ✅ Vô hiệu hoá Ctrl+D
set -o ignoreeof

# 🔐 Mật khẩu yêu cầu khi thoát
PASSWORD="adminav4x04"

# Hàm yêu cầu mật khẩu khi thoát
secure_exit() {
    echo -n "Enter password to exit: "
    read -s user_pass
    echo ""

    if [ "$user_pass" = "$PASSWORD" ]; then
        echo "✅ Access granted. Exiting..."
        exit 0
    else
        echo "❌ Wrong password! Access denied."
        return 1
    fi
}

# Ghi đè các lệnh để bắt buộc kiểm tra mật khẩu
alias exit='secure_exit'
alias logout='secure_exit'
alias reboot='secure_exit'
alias shutdown='secure_exit'

# Export nếu cần cho subshell
export -f secure_exit
