#!/bin/bash

# Script bảo mật để thoát khỏi hệ thống
secure_exit() {
    local PASSWORD="adminav4x04"
    
    echo -n "Enter password to exit: "
    read -s user_pass
    echo ""
    
    if [ "$user_pass" = "$PASSWORD" ]; then
        echo "Access granted. Exiting..."
        exit 0
    else
        echo "Wrong password! Access denied."
        return 1
    fi
}

# Override exit và logout commands
alias exit='secure_exit'
alias logout='secure_exit'
alias reboot='secure_exit'
alias shutdown='secure_exit'

# Trap EXIT signal (nhưng không block Ctrl+D cho Python)
trap_exit() {
    # Chỉ yêu cầu password khi thoát shell chính
    if [ "$SHLVL" -eq 1 ]; then
        secure_exit
    fi
}

# Export function để có thể dùng trong subshell
export -f secure_exit
