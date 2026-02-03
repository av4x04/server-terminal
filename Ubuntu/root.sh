#!/bin/sh

ROOTFS_DIR=$(pwd)
export PATH=$PATH:~/.local/usr/bin
max_retries=50
timeout=1
ARCH=$(uname -m)

# Màu mè tí cho dễ nhìn
RED='\e[1;31m'
GREEN='\e[1;32m'
CYAN='\e[0;36m'
YELLOW='\e[1;33m'
WHITE='\e[0;37m'
RESET_COLOR='\e[0m'

if [ "$ARCH" = "x86_64" ]; then
  ARCH_ALT=amd64
elif [ "$ARCH" = "aarch64" ]; then
  ARCH_ALT=arm64
else
  printf "${RED}Unsupported CPU architecture: ${ARCH}${RESET_COLOR}\n"
  exit 1
fi

if [ ! -e $ROOTFS_DIR/.installed ]; then
  echo "#######################################################################################"
  echo "#"
  echo "#                                 Foxytoux INSTALLER"
  echo "#"
  echo "#                           Copyright (C) 2024, RecodeStudios.Cloud"
  echo "#"
  echo "#"
  echo "#######################################################################################"

  echo -e "${GREEN}[*] Auto-detect: Installing Ubuntu automatically...${RESET_COLOR}"
  
  # Đoạn này tao bỏ case/read, cho chạy thẳng luôn
  wget --tries=$max_retries --timeout=$timeout --no-hsts -O /tmp/rootfs.tar.gz \
    "http://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.3-base-${ARCH_ALT}.tar.gz"
  tar -xf /tmp/rootfs.tar.gz -C $ROOTFS_DIR
fi

# Logic tải proot giữ nguyên
if [ ! -e $ROOTFS_DIR/.installed ]; then
  mkdir $ROOTFS_DIR/usr/local/bin -p
  wget --tries=$max_retries --timeout=$timeout --no-hsts -O $ROOTFS_DIR/usr/local/bin/proot "https://raw.githubusercontent.com/av4x04/freeroot/main/proot-${ARCH}"

  while [ ! -s "$ROOTFS_DIR/usr/local/bin/proot" ]; do
    rm $ROOTFS_DIR/usr/local/bin/proot -rf
    wget --tries=$max_retries --timeout=$timeout --no-hsts -O $ROOTFS_DIR/usr/local/bin/proot "https://raw.githubusercontent.com/av4x04/freeroot/main/proot-${ARCH}"

    if [ -s "$ROOTFS_DIR/usr/local/bin/proot" ]; then
      chmod 755 $ROOTFS_DIR/usr/local/bin/proot
      break
    fi

    chmod 755 $ROOTFS_DIR/usr/local/bin/proot
    sleep 1
  done

  chmod 755 $ROOTFS_DIR/usr/local/bin/proot
fi

# Config DNS và dọn rác
if [ ! -e $ROOTFS_DIR/.installed ]; then
  printf "nameserver 1.1.1.1\nnameserver 1.0.0.1" > ${ROOTFS_DIR}/etc/resolv.conf
  rm -rf /tmp/rootfs.tar.xz /tmp/sbin
  touch $ROOTFS_DIR/.installed
fi

chmod +x $ROOTFS_DIR/setup-bashrc.sh
$ROOTFS_DIR/setup-bashrc.sh

display_gg() {
  echo -e "${WHITE}___________________________________________________${RESET_COLOR}"
  echo -e ""
  echo -e "           ${CYAN}-----> Mission Completed ! <----${RESET_COLOR}"
}

clear
display_gg

# Chạy proot
$ROOTFS_DIR/usr/local/bin/proot \
  --rootfs="${ROOTFS_DIR}" \
  -0 -w "/root" -b /dev -b /sys -b /proc -b /etc/resolv.conf --kill-on-exit \
  /bin/bash -c "
    while true; do
      su -c 'clear; exec bash'
      # Tao sửa lại đoạn này cho gọn, khỏi khung hình chữ nhật xấu òm
      echo -e '\n${YELLOW}[!] Shell disconnected / Session closed.${RESET_COLOR}'
      echo -e '${CYAN}[*] Restarting session in 1 second...${RESET_COLOR}\n'
      sleep 1
    done
  "
