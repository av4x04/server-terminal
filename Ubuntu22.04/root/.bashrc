# ============================================================
# Custom Bash Configuration for admin@client (Hardened Shell)
# ============================================================

# --- Color Prompt ---
RED='\[\e[0;31m\]'
RESET='\[\e[0m\]'
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
# Custom Banner (Kali Dragon + System Info)
# ============================================================
show_banner() {
    cat <<'ASCIIART'
..,;:ccc,.                             ---------- 
          ......''';lxO.                           OS: Kali GNU/Linux Rolling x86_64 
.....''''..........,:ld;                           Host: Dell Inc. 05GRXT 
           .';;;:::;,,.x,                          Kernel: 6.12.38+kali-amd64 
      ..'''.            0Xxoc:,.  ...              Uptime: 19 mins 
  ....                ,ONkc;,;cokOdc',.            Packages: 2848 (dpkg) 
 .                   OMo           ':ddo.          Shell: zsh 5.9 
                    dMc               :OO;         Resolution: 1503x845 
                    0M.                 .:o.       DE: Xfce 4.20 
                    ;Wd                            WM: Xfwm4 
                     ;XO,                          WM Theme: Kali-Dark 
                       ,d0Odlc;,..                 Theme: Kali-Dark [GTK2/3] 
                           ..',;:cdOOd::,.         Icons: Flat-Remix-Blue-Dark [GTK2/3] 
                                    .:d;.':;.      Terminal: qterminal 
                                       'd,  .'     Terminal Font: FiraCode 10 
                                         ;l   ..   CPU: Intel i5-3230M (4) @ 3.200GHz 
                                          .o       GPU: Intel 3rd Gen Core processor Graphics Controller 
                                            c      Memory: 2956MiB / 3794MiB 
                                            .'
                                              Kali Linux Dragon
ASCIIART

    # --- Runtime System Info ---
    if command -v lsb_release >/dev/null 2>&1; then
        OS="$(lsb_release -ds)"
    elif [ -r /etc/os-release ]; then
        OS="$(. /etc/os-release && printf "%s %s" "$NAME" "$VERSION")"
    else
        OS="Unknown OS"
    fi

    HOST="$(hostname 2>/dev/null || echo 'Unknown')"
    KERNEL="$(uname -r 2>/dev/null || echo 'Unknown')"
    UPTIME="$(uptime -p 2>/dev/null | sed 's/up //')"
    PACKAGES="$(dpkg -l 2>/dev/null | awk 'NR>5 {count++} END{print (count+0)}') (dpkg)"
    SHELLINFO="$(ps -p $$ -o comm= 2>/dev/null || echo "$SHELL")"
    RESOLUTION="$(xrandr 2>/dev/null | awk '/\*/ {print $1; exit}' || echo 'N/A')"
    DE="${XDG_CURRENT_DESKTOP:-${DESKTOP_SESSION:-N/A}}"
    WM="${XDG_SESSION_DESKTOP:-N/A}"
    CPU="$(lscpu 2>/dev/null | awk -F: '/Model name/ {gsub(/^[ \t]+/, "", $2); print $2; exit}')"
    GPU="$(lspci 2>/dev/null | grep -i 'vga\\|3d\\|display' | head -n1 | cut -d: -f3- | sed 's/^[ \t]*//' )"
    MEM_USED="$(free -h 2>/dev/null | awk '/^Mem:/ {print $3}')"
    MEM_TOTAL="$(free -h 2>/dev/null | awk '/^Mem:/ {print $2}')"
    MEMORY="${MEM_USED} / ${MEM_TOTAL}"

    echo ""
    printf "  %-12s %s\n" "OS:" "$OS"
    printf "  %-12s %s\n" "Host:" "$HOST"
    printf "  %-12s %s\n" "Kernel:" "$KERNEL"
    printf "  %-12s %s\n" "Uptime:" "$UPTIME"
    printf "  %-12s %s\n" "Packages:" "$PACKAGES"
    printf "  %-12s %s\n" "Shell:" "$SHELLINFO"
    printf "  %-12s %s\n" "Resolution:" "$RESOLUTION"
    printf "  %-12s %s\n" "DE:" "$DE"
    printf "  %-12s %s\n" "WM:" "$WM"
    printf "  %-12s %s\n" "CPU:" "$CPU"
    printf "  %-12s %s\n" "GPU:" "$GPU"
    printf "  %-12s %s\n" "Memory:" "$MEMORY"
    echo ""
}

# --- Show Banner Only in Interactive Shells ---
case "$-" in
    *i*) show_banner ;;
    *) ;;
esac
