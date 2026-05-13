#!/bin/bash
# ArkDock - 修复 macOS 安全提示
# 如果打开 ArkDock 时提示"已损坏"或"无法验证开发者"，双击运行此脚本即可修复。

APP_PATH="/Applications/ArkDock.app"
if [ ! -d "$APP_PATH" ]; then
    APP_PATH="$(dirname "$0")/ArkDock.app"
fi

if [ ! -d "$APP_PATH" ]; then
    echo "未找到 ArkDock.app，请先将其拖入 Applications 文件夹。"
    read -p "按回车键关闭..."
    exit 1
fi

echo "正在修复 ArkDock..."
echo ""
sudo xattr -cr "$APP_PATH"
sudo codesign --force --deep --sign - "$APP_PATH"
echo ""
echo "修复完成！现在可以正常打开 ArkDock 了。"
read -p "按回车键关闭..."
