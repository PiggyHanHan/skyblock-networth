# skyblock-networth

A small command-line tool for looking up a Hypixel SkyBlock player's networth.

Player data comes from the official [Hypixel Public API](https://api.hypixel.net/), and item values are calculated locally with [SkyHelper-Networth](https://github.com/Altpapier/SkyHelper-Networth). Nothing is uploaded anywhere.

[中文说明](README.zh-CN.md)

## Features

- Look up by Minecraft username or UUID (UUID is resolved through the Mojang API)
- Reports three figures: total networth, unsoulbound networth and non-cosmetic networth
- Breaks the total down by container: armor, equipment, accessories, inventory, ender chest, storage, pets, essence, museum and more
- Ranks the most valuable items in the profile
- `--json` output for scripting
- Select a specific profile with `--profile`, or list every profile with `--list`
- Local web dashboard with a visual breakdown of the profile

## Requirements

- Node.js 18 or newer

## Setup

```bash
npm install
```

Create an API key at the [Hypixel Developer Dashboard](https://developer.hypixel.net), then add it to a `.env` file in the project root:

```
HYPIXEL_API_KEY=your-key-here
```

The key can also be supplied through the `HYPIXEL_API_KEY` environment variable or the `--key` flag. `.env` is listed in `.gitignore` and is never committed.

## Usage

```bash
node nw.js <username|uuid>              # uses the profile selected in game
node nw.js _Ninym_ --profile Mango      # query a specific profile
node nw.js _Ninym_ --list               # list all profiles, no calculation
node nw.js _Ninym_ --top 20             # show the 20 most valuable items
node nw.js _Ninym_ --json               # machine-readable output
node nw.js _Ninym_ --no-museum          # skip museum data (faster)
```

Options:

| Flag | Description |
|---|---|
| `--profile <name\|id>` | Profile cute name or profile UUID |
| `--list` | List profiles only |
| `--top <n>` | Number of items to show, `0` disables the list (default 8) |
| `--no-museum` | Skip the museum endpoint |
| `--json` | Print JSON instead of a formatted report |
| `--fresh` | Bypass the 5-minute price cache |
| `--key <key>` | API key for this run |
| `-h`, `--help` | Show help |

## Web UI

A local dashboard is included. The API key stays in the Node process; the browser only receives the computed result.

```bash
npm start
# open http://127.0.0.1:5173
```

Search by username, switch between profiles, and read the breakdown as bars plus a ranking of the most valuable items.

## How it works

1. Resolve the username to a UUID using the Mojang API (does not consume Hypixel rate limit).
2. Fetch the player's profiles from `GET /v2/skyblock/profiles` and the selected profile's museum from `GET /v2/skyblock/museum`.
3. Load SkyHelper's public price list, cached locally for five minutes.
4. Parse the NBT-encoded inventories and calculate the value of every item on the local machine.

Hypixel returns profile data as GZip-compressed NBT; all decoding and valuation happens in this process.

## Disclaimer

This is an unofficial project and is not affiliated with Hypixel. If you use it, follow the [Hypixel API policy](https://developer.hypixel.net/): do not publish your key, and do not reuse one key across multiple applications.

## License

MIT
