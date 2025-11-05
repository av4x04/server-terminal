# ============================================================
# Custom Bash Configuration for admin@client (Hardened Shell)
# ============================================================

# --- Color Prompt ---
RED='

\[\e[0;31m\]

'
RESET='

\[\e[0m\]

'
export PS1="${RED}admin@client${RESET}:~# "

# --- Restrict Exit (Ctrl+D) ---
set -o ignoreeof
export IGNOREEOF=999

# --- Disable Dangerous Builtins ---
enable -n exit 2>/dev/null
enable -n logout 2>/dev/null
enable -n exec 2>/dev/null
enable -n source 2>/dev/null

# --- Safe Aliases ---
alias exit='echo "Command disabled: exit"'
alias logout='echo "Command disabled: logout"'
alias builtin='echo "Command disabled: builtin"'
alias command='echo "Command disabled: command"'
alias enable='echo "Command disabled: enable"'
alias exec='echo "Command disabled: exec"'
alias source='echo "Command disabled: source"'
alias .='echo "Command disabled: source"'

# --- Prevent Shell Spawn ---
alias bash='echo "Command disabled: bash"'
alias sh='echo "Command disabled: sh"'
alias dash='echo "Command disabled: dash"'

# --- Disable System Commands ---
alias reboot='echo "Command disabled: reboot"'
alias poweroff='echo "Command disabled: poweroff"'
alias shutdown='echo "Command disabled: shutdown"'
alias halt='echo "Command disabled: halt"'

# --- Disable Kill/Process Commands ---
alias kill='echo "Command disabled: kill"'
alias killall='echo "Command disabled: killall"'
alias pkill='echo "Command disabled: pkill"'
alias ps='echo "Command disabled: ps"'

# --- Function Overrides ---
function exit()   { echo "Command disabled: exit"; }
function logout() { echo "Command disabled: logout"; }
function exec()   { echo "Command disabled: exec"; }
function builtin(){ echo "Command disabled: builtin"; }
function command(){ echo "Command disabled: command"; }
function enable() { echo "Command disabled: enable"; }

export -f exit logout exec builtin command enable

# --- Trap Dangerous Commands ---
function __trap_debug_command() {
    local cmd="${BASH_COMMAND}"

    # Block kill variants
    if [[ "$cmd" =~ (^|[[:space:]])(kill|pkill|killall)([[:space:]]|$) ]]; then
        echo "⚠️  Action blocked: kill command"
        return 1
    fi

    # Block shell spawning
    if [[ "$cmd" =~ (^|[[:space:]])(bash|sh|dash)([[:space:]]|$) ]]; then
        echo "⚠️  Action blocked: shell spawn"
        return 1
    fi

    # Block env
    if [[ "$cmd" =~ (^|[[:space:]])env([[:space:]]|$) ]]; then
        echo "⚠️  Action blocked: env command"
        return 1
    fi

    return 0
}
trap '__trap_debug_command' DEBUG

# --- Lock Critical Variables ---
readonly PROMPT_COMMAND 2>/dev/null
readonly BASH_ENV 2>/dev/null

# --- Harden PATH ---
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# ============================================================
# Banner (Simple Welcome Message)
# ============================================================

show_banner() {
    echo "Welcome to admin@client shell"
}

# --- Show Banner Only in Interactive Shells ---
case "$-" in
    *i*) show_banner ;;
    *) ;;
esac
