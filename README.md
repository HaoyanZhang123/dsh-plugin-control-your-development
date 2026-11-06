<p align="center">
  <img src="assets/images/threadline-cover.png" alt="Threadline 1.1: all directory clusters at once, two independent scroll panes, relation evidence and draggable nodes" width="100%">
</p>

<h1 align="center">Threadline · 脉络</h1>
<p align="center">A permanent read-only visual map of how a DeepSeek Harness workspace actually developed.</p>
<p align="center"><a href="README.zh.md">中文</a></p>
<p align="center">
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white" alt="React 18"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-4B6BFB" alt="DeepSeek Harness plugin"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License MIT"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.1.0-blue" alt="Version 1.1.0"></a>
</p>

## Overview

Threadline answers a question that chat logs do not: **what did this workspace actually go through, and what did each turn change?**

It reads what DeepSeek Harness has already recorded — sessions, subagents, tool calls, file operations, commands, background jobs — and turns it into a growing relationship map of the current workspace. Files that DSH touched become nodes, grouped by directory; turns become a strip at the bottom; every number can be traced back to a recorded event.

It is **permanently read-only**. It never writes to your workspace, your session logs or your settings, never calls a model, and never makes an outbound request. It cannot start, stop or retry anything — there is deliberately no control surface at all.

Typical use: you come back to a long session, or hand a workspace to someone else, and want to see where the work went.

## Features

- **Overview star map by default** — all directory clusters (every directory card; top 3 files each + `+N`), not single-directory drill-down.
  Only directory-level weak relations are drawn by default; hover/click a card or cluster to expand its top 12 files and avoid a 3,000-node hairball.
- **Two independent scroll panes** — the wheel scrolls the left pane only over the left pane and the right pane only over the right pane; the page/shell does not scroll; below 960px it falls back to one page scroll with stacked sections.
- **Interactive nodes** — hover scales/glows the node, brightens connected edges and dims unrelated ones; drag nodes (in-memory only; double-click or Reset restores); 180–240ms transitions on turn changes.
- **Explainable relations** — multiple relations between the same file pair merge into one line with type badges; relation-type chips show counts and filter; click a file/edge for an evidence popover; the footer shows loaded-session coverage. Co-occurrence is not dependency; weight is count only.
- **Directory relation summary / turn relation badge** — cards show how many other directories they relate to and the top partner; turn blocks show the number of relations among that turn's files.
- **Turn status only from recorded facts** — `read N`, `write +A / −D lines`, `first seen`; file-level add/delete is not provable and is not shown. The summary bar is fixed to one line, full wording in the tooltip.
- **Per-turn impact icon** — under a finished assistant message; click jumps to the Threadline tab and focuses that turn, with no dialog.
- **`/threadline` command** — a shortcut to the tab; no dialog, no fourth entry.
- **Loading does not lie** — a skeleton plus “Loading files for T{n}…” while detail is pending; “no file operations” only after ready with zero files.
- **Privacy mode / list view / progressive load / permanently read-only** — paths and titles can be masked; keyboard reachable; unloaded, failed and unobserved are labelled.

## Installation

Requirements: DeepSeek Harness **0.2.2-rc.1** or newer, on a desktop or web profile.

Install it as a DSH plugin from npm:

```text
Plugin manager → Add plugin → dsh-plugin-control-your-development@1.1.0
```

Or install into a profile directly:

```bash
dsh plugin add dsh-plugin-control-your-development@1.1.0 --profile desktop
```

Then reload the page (client code) or restart DSH (host code).

> Installed DSH plugins do not update automatically. Upgrading means uninstalling and installing the new version — this is a DSH behaviour, not a Threadline one.

## Usage

Open a conversation and pick the **Threadline** tab next to chat / trajectory. The tab fills the conversation area; the left and right panes scroll independently.

<p align="center">
  <img src="assets/images/threadline-map.png" alt="Threadline 1.1: all directory clusters and two directory card columns; two independent scroll panes" width="100%">
</p>

- See every directory cluster by default; hover/click a directory card or a cluster in the map to expand its files; click to pin.
- Click a file node for relations; click relation-type chips to filter; drag nodes to arrange; double-click or “Reset layout” restores.
- Click a turn to see its files, read/written lines, first-seen and relations; click again or Esc to return to the overview.
- The timeline plays the workspace back in time; ranges are **today / 7 days / 30 days / all**.
- `/threadline` jumps to the tab; the per-turn impact icon jumps and focuses that turn.

<p align="center">
  <img src="assets/images/threadline-focus.png" alt="A directory cluster expanded to its top 12 files; other clusters dimmed" width="100%">
</p>

<p align="center">
  <img src="assets/images/threadline-turn.png" alt="Turn view: read / written-line / first-seen status and relation types" width="100%">
</p>

Threadline only reads the workspace the current session belongs to. Sessions from other workspaces, profiles or machines are not aggregated.

## Configuration

None. There is no configuration file, no setting, no stored preference and no cached artefact — all filters, selections and time ranges live in memory and reset when you reload. The only thing it needs is the workspace it is already in.

## Project structure

```text
plugin/
  src/shared/      event reducer, relation engine, reference parsers
  src/host/        read-only scan, in-memory index, local read-only routes
  src/client/      data layer, UI, three entries
  lib/             build output loaded by DSH (do not edit)
  tests/           unit, integration and screenshot harness
```

## Releases

Current release: **panel plugin v1.1.0** (stable).

See [CHANGELOG.md](CHANGELOG.md) for what changed in each version, and the [Releases](https://github.com/HaoyanZhang123/dsh-plugin-control-your-development/releases) page for installable versions.

## License

[MIT](LICENSE)
