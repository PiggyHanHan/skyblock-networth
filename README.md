# skyblock-networth

一个轻量的命令行工具，用来查询 Hypixel SkyBlock 玩家的净值（networth）。数据来自 Hypixel 官方 Public API，净值由 [SkyHelper-Networth](https://github.com/Altpapier/SkyHelper-Networth) 在本地计算。

## 功能

- 支持游戏 ID 或 UUID 查询，自动解析 Mojang UUID
- 输出总净值、不含灵魂绑定、不含化妆品三档数值
- 按容器分类展示明细：护甲、装备、饰品、背包、末影箱、箱子仓库、宠物、精华、博物馆等
- 列出最贵物品排行，支持 `--json` 供其他程序调用
- 支持指定档案（`--profile`），或列出玩家全部档案（`--list`）

## 安装

需要 Node.js 18 及以上。

```bash
npm install
```

## 配置 API Key

在 [Hypixel Developer Dashboard](https://developer.hypixel.net) 创建密钥，然后写入项目根目录的 `.env`：

```
HYPIXEL_API_KEY=你的密钥
```

也可以直接用环境变量或 `--key` 参数传入。`.env` 已被 `.gitignore` 忽略，不会进入版本库。

## 使用

```bash
node nw.js <游戏ID或UUID>                 # 默认查询游戏内选中的档案
node nw.js _Ninym_ --profile Mango        # 指定档案
node nw.js _Ninym_ --list                 # 只列出所有档案
node nw.js _Ninym_ --top 20               # 显示最贵 20 件物品
node nw.js _Ninym_ --json                 # 机器可读输出
node nw.js _Ninym_ --no-museum            # 跳过博物馆数据，更快
```

## 实现说明

- 玩家名到 UUID 使用 Mojang 官方接口，不消耗 Hypixel 限额
- 玩家档案来自 `GET /v2/skyblock/profiles`，博物馆来自 `GET /v2/skyblock/museum`
- 价格取自 SkyHelper 的公开价格表，本地缓存 5 分钟
- 净值计算完全在本地完成，不上传任何玩家数据

## 免责声明

本项目非 Hypixel 官方项目。使用时请遵守 [Hypixel API 政策](https://developer.hypixel.net/)：不要公开分享密钥，不要把密钥用于多个应用。

## License

MIT
