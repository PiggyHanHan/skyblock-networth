# skyblock-networth

一个轻量的命令行工具，用来查询 Hypixel SkyBlock 玩家的净值（networth）。数据来自 [Hypixel 官方 Public API](https://api.hypixel.net/)，物品价值由 [SkyHelper-Networth](https://github.com/Altpapier/SkyHelper-Networth) 在本地计算，不上传任何玩家数据。

[English](README.md)

## 功能

- 支持游戏 ID 或 UUID 查询，自动通过 Mojang 接口解析 UUID
- 输出总净值、不含灵魂绑定、不含化妆品三档数值
- 按容器分类展示明细：护甲、装备、饰品、背包、末影箱、箱子仓库、宠物、精华、博物馆等
- 列出最贵物品排行，支持 `--json` 供其他程序调用
- 支持指定档案（`--profile`），或列出玩家全部档案（`--list`）
- 自带本地网页界面，可视化展示净值构成

## 环境要求

- Node.js 18 及以上

## 安装

```bash
npm install
```

在 [Hypixel Developer Dashboard](https://developer.hypixel.net) 创建密钥，写入项目根目录的 `.env`：

```
HYPIXEL_API_KEY=你的密钥
```

也可以通过 `HYPIXEL_API_KEY` 环境变量或 `--key` 参数传入。`.env` 已列入 `.gitignore`，不会进入版本库。

## 使用

```bash
node nw.js <游戏ID或UUID>                 # 默认查询游戏内选中的档案
node nw.js _Ninym_ --profile Mango        # 指定档案
node nw.js _Ninym_ --list                 # 只列出所有档案
node nw.js _Ninym_ --top 20               # 显示最贵 20 件物品
node nw.js _Ninym_ --json                 # 机器可读输出
node nw.js _Ninym_ --no-museum            # 跳过博物馆数据，更快
```

参数说明：

| 参数 | 说明 |
|---|---|
| `--profile <名称\|ID>` | 档案名称或档案 UUID |
| `--list` | 只列出档案 |
| `--top <n>` | 显示物品数量，`0` 表示关闭（默认 8） |
| `--no-museum` | 跳过博物馆接口 |
| `--json` | 输出 JSON |
| `--fresh` | 强制刷新价格缓存 |
| `--key <key>` | 临时指定密钥 |
| `-h`, `--help` | 显示帮助 |

## 网页界面

自带一个本地看板。密钥只保存在 Node 进程里，浏览器拿到的只有计算结果。

```bash
npm start
# 打开 http://127.0.0.1:5173
```

输入游戏 ID 即可查询，支持切换档案，分类明细以条形图展示，右侧列出最贵物品。

## 实现说明

1. 通过 Mojang 接口把游戏 ID 解析为 UUID（不消耗 Hypixel 限额）
2. 从 `GET /v2/skyblock/profiles` 拉取档案，从 `GET /v2/skyblock/museum` 拉取博物馆
3. 读取 SkyHelper 公开价格表，本地缓存 5 分钟
4. 解码 NBT 格式的库存数据，在本机计算每件物品的价值

Hypixel 返回的库存数据是 GZip 压缩的 NBT，解码与估值全部在本进程完成。

## 免责声明

本项目非 Hypixel 官方项目。使用请遵守 [Hypixel API 政策](https://developer.hypixel.net/)：不要公开分享密钥，不要把一个密钥用于多个应用。

## License

MIT
