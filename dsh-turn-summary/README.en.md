# dsh-turn-summary — Turn Summary

> A DeepSeek Harness (DSH) plugin: one fixed summary line at the **end of every completed reply** — which skills this turn loaded, and how many times each tool was called.

```
This turn · skill: dsh-client-ui-ux | tools: read×2, grep×1
This turn · skill: None | tools: None
```

The line is **not collapsible, not clickable, and carries no command**: it sits in the turn tail (outside the collapsible tool group), so it stays visible even when the tool card is folded away.

## Zero tokens: the data comes from events the client already received

| Aspect | Behaviour |
|---|---|
| Model request | **None.** The line never asks the model to report its own usage |
| Prompt | **None.** No prompt section, no tool registration |
| Session log | **None.** No new session events, no session-log writes |
| Data source | `turn/start` / `tool/call` events the client **already received**, folded in the browser |
| Network | **None.** Folding and rendering happen locally |

The fold is a pure function (no React, no Cordis, no model) and can be replayed from a recorded session log.

## What it shows

| Segment | Content | When empty |
|---|---|---|
| skill | Distinct skill names loaded this turn, in first-load order | Explicitly spelled out as “None” |
| plugins | Plugin names owning this turn's tools | The **whole segment is omitted** — the client has no tool→plugin map, and guessing would be dishonest |
| tools | Call count per tool, in first-use order | Explicitly spelled out as “None” |

A `skill` tool call lands in the skill segment only — it is never counted again as a tool.

## Layout

```
dsh-turn-summary/
├── package.json          package metadata (DSH bundle / client declaration)
├── cordis.patch.yml      profile bundle row: id=turn-summary, name=dsh-turn-summary
├── lib/
│   ├── client.js         browser half (the file DSH actually loads)
│   ├── client.js.map     browser sourcemap (`sources` rewritten to ../src/client/*)
│   └── index.js          host half (empty apply, so the plugin shows up in the bundle layer)
├── locale/               plugin name and description in eight languages
├── src/                  ★ byte-exact snapshot of the upstream TypeScript sources
└── tests/                zero-dependency regression suite (node --test)
```

### About `src/`: a snapshot, not a build entry point

`src/` is a **byte-exact copy** of the upstream monorepo TypeScript sources (`deepseek-ai/deepseek-harness`, `packages/client/ui-turn-summary`). This repository contains **no build chain** — no tsdown/tsc, no node_modules, no build scripts.

Therefore:

- To **change behaviour**: change the TypeScript upstream, rebuild, carry the new `lib/client.js` / `lib/client.js.map` into this repository, and commit both;
- **In production `lib/` is authoritative** — DSH loads `lib/client.js`, `src/` never runs;
- **The specification is [`docs/dsh-turn-summary 原理与业务流程.md`](../docs/dsh-turn-summary%20原理与业务流程.md)** (the single authoritative spec);
- The suite contains a **drift guard**: `lib/client.js.map`'s embedded `sourcesContent` must be byte-identical to the `src/client/*` files on disk.

## Install

### Recommended: the self-hosted plugin market

1. DSH Settings → Plugin Market, add the index URL:
   `https://cdn.jsdelivr.net/gh/hiyisen/dsh-plugin@main/market/index.json`
2. Find “Turn Summary” in the market → Install
3. Restart DSH; the line appears under every completed reply from then on

### Manual install

```bash
cp -r dsh-turn-summary ~/.dsh/profiles/desktop/
# profile/package.json add: dependencies "dsh-turn-summary":"link:./dsh-turn-summary"
#                         dsh.profile.bundles add "dsh-turn-summary"
ln -sfn ../dsh-turn-summary ~/.dsh/profiles/desktop/node_modules/dsh-turn-summary
```

## Known limitations

1. **The “plugins” segment never appears**: the client has no tool→plugin ownership table. Writing “None” would falsely claim that no plugin was involved, so the segment is omitted entirely.
2. **Long tool lists are ellipsised**: the line is a single `nowrap` row and overflows with `…` (the full data still lives in the session events).
3. **It appears only after a reply completes**: the fold covers finished turns; an in-flight turn shows no line.
4. **Only top-level `tool/call` events are counted**: tool calls nested inside sub-agents never reach the top-level event stream and are not counted.

Additionally: a skill whose arguments cannot be parsed (invalid JSON, or longer than 4096 characters) shows as “unknown”; skill names are truncated to 120 **code points**; at most 16 distinct skill names are kept per turn (further calls are still counted, only the name is dropped).

## Development

```bash
# zero-dependency regression suite (Node >= 18, no npm install); run from the repository root
node --test "dsh-turn-summary/tests/*.test.mjs"
# equivalent, from the repository root (Node >= 22 searches the cwd recursively):
node --test
```

> Node >= 22 treats positional arguments of `--test` as glob patterns and no longer recurses into directories, so `node --test dsh-turn-summary/tests/` (the Node 18/20 form) fails with `Cannot find module` on Node 22.

The suite drives the **published `lib/client.js`** itself (fake `window.__ModuleLoader__`, a minimal React stand-in, a fake client context) rather than re-implementing the fold, so it guards the shipped bytes.

**Artifact convention**: changing `src/` requires re-carrying and committing `lib/`, otherwise the drift guard fails. Only two comments may change in `lib/client.js` (absolute-path leakage); every other byte is preserved verbatim.

## Upstream

- Repository: `deepseek-ai/deepseek-harness`, package path `packages/client/ui-turn-summary`
- Introducing commit: `2094ced757` (feat(client): 新增 ui-turn-summary 用户态插件)
- Artifact sync commit: `4cd87dc33c` (chore: 同步 ui-turn-summary 引入的生成物与工程配置)

## License

MIT
