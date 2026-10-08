# dsh-plugin-control-your-development

> Turn the development process into a product dashboard you can actually read and control.
> Three human-readable Markdown files are the single source of truth; one command renders a single-file offline web page. Optionally, pin the dashboard inside the DSH window's right sidebar.

Versions: skill v1.2.0 · panel plugin v0.4.2 | License: [MIT](LICENSE) | 语言：[中文](README.md)

---

## What is this

You're building a product with AI, but code, commit logs and terminals are not your language. **control-your-development** translates "how far along is development" into a product-level dashboard:

- What the product does and where it's heading — one page, plain words;
- Where every feature stands, with a progress bar that counts only features **you have personally verified**;
- What changed recently and what decisions are **waiting for you** — open it and know.

It is a DSH skill (teaches the AI to maintain your dashboard) plus an optional DSH panel plugin (embeds the dashboard in the DSH right sidebar). The generated page is a single HTML file: double-click to open, works offline, and can be sent to partners or clients as-is.

## 30-second quick start

Prerequisite: DSH desktop is installed.

1. **Install the plugin (one step — it also installs the bundled skill)**: DSH → Plugins → Add plugin → enter:

   ```
   dsh-plugin-control-your-development
   ```

   This installs from the npm registry (a local mirror is used automatically in China — no GitHub access needed). On activation the plugin installs the skill it ships into the **global skills directory** (`<dshHome>/skills/`) — available in **every workspace**, no manual copying.

   > **Verified on real machines: macOS and Windows.** If npm is unreachable, use the offline `.tgz` attached to the Release (Add plugin → absolute path of the file).

2. Open your project in DSH and say to the AI: **"control my development"** (or "set up a development dashboard for me").

3. The AI creates `dev-dashboard/` and renders `index.html`; the right sidebar panel shows the dashboard of **the workspace you have open** — switch projects and it follows (a workspace without a dashboard gets a copy-instruction button).

> Prefer no plugin? Copy `skill/control-your-development/` into your project's `.dsh/skills/` (create that directory first, or `cp` fails on a fresh project).

For full installation options (global install, panel plugin, uninstall & upgrade), see [INSTALL.md](INSTALL.md).

## Take a look

**Dashboard · Project home** — one-line positioning, current direction, the control strip.
<img width="2968" height="1736" alt="Dashboard · Project home — one-line posi" src="https://github.com/user-attachments/assets/ad57e7da-bc41-4ed7-b03d-fd44a9b5075e" />

**Feature Map** — five-state cards (Idea / In Progress / Usable / Verified / Deprecated) + dependency graph.
<img width="2648" height="1078" alt="Feature Map — five-state cards (Idea / I" src="https://github.com/user-attachments/assets/c5647de2-f4c6-47b9-9599-8e83f1aa6b57" />

**Now** — the timeline and the decision cards waiting for your call.
<img width="2620" height="1256" alt="Now — the timeline and the decision card" src="https://github.com/user-attachments/assets/dbe24c34-2da5-470f-90b6-1a94ee92339e" />

**Embedded panel** in the DSH right sidebar (next to Files / Terminal / Browser, title carries the project name).
<img width="1042" height="1088" alt="Embedded panel in the DSH right sidebar " src="https://github.com/user-attachments/assets/83429749-b03f-4132-a4c5-612ba7d36453" />

## Highlights

**Three human-readable files, one job each**
- `PRODUCT.md`: the front door — what this is, who it's for, where it's heading;
- `FEATURES.md`: status — where every feature stands, with evidence and dependencies;
- `NOW.md`: the pulse — what happened lately, what's waiting for your decision.

**Progress defined by you (state machine)**
Every feature moves along Idea → In Progress → Usable → Verified. The AI may mark a feature "Usable" at most; "Verified" happens only when you say so — and the progress bar counts verified features only. States can also move back: revoking a verification returns to Usable (nothing broke — the stamp is just withdrawn), rework returns to In Progress, deprecation moves to Deprecated, and a deprecated feature can be restored to Idea. Every rollback gets a line in the timeline.

**Decision center**
The AI turns open questions into option cards: pick, add a note, or copy a ready-made reply. Every decision you make is recorded in the timeline.

**Single-file offline page**
The dashboard is one `index.html`: zero dependencies, zero network, light/dark adaptive, print-friendly. Send it over chat, email or a USB stick — it opens identically everywhere.

**Embedded panel (optional)**
Install `dsh-plugin-control-your-development` and the dashboard lives in the DSH right sidebar (alongside Files and Terminal): it auto-refreshes when files change, and action buttons copy instructions back to the chat — look in the panel, act in the conversation.

**Honesty mechanism — omissions raise alarms**
- Every code change must be either incorporated into the dashboard or explicitly ignored — **silent omission is not allowed**;
- Missing evidence files or unfiled facts make the render step fail loudly, instead of shipping a dashboard that "looks fine";
- Every feature description must cite files that actually exist; fabrication is not possible.

## Installation

| What | Fastest path |
|---|---|
| **Plugin + skill (recommended, one step)** | DSH → Plugins → Add plugin → enter `dsh-plugin-control-your-development` (npm package name; a mirror is used in China). The plugin installs the bundled skill globally |
| Skill only (no panel) | Copy `skill/control-your-development/` into your project's `.dsh/skills/` |

Full options (global install, offline install, uninstall & upgrade): [INSTALL.md](INSTALL.md)

## Daily use

Once installed, drive it in plain language inside DSH:

| You say | The AI does |
|---|---|
| "control my development" / "set up the dashboard" | Initializes dev-dashboard |
| "This phase is done — update the dashboard" | Collects changes, updates the three files, re-renders the page |
| "Decision D1: A and C; note: monthly view only" | Records your call and continues development |
| "I've verified the expense logging feature" | Marks the feature Verified; the progress bar moves |

You never edit the web page by hand — it is a machine artifact, always regenerated from the three Markdown files.

## What's in the repo

```
dsh-plugin-control-your-development/
├─ package.json / cordis.patch.yml   ← panel manifest (repo root IS the plugin package)
├─ lib/ src/ tools/                  ← panel: browser bundle / source / build script
├─ PLUGIN.md                         ← panel notes and development gotchas
└─ skill/
   └─ control-your-development/      ← the capability itself
      ├─ SKILL.md / manifest.yaml    ← skill definition
      ├─ static/                     ← the AI's working discipline and workflow
      ├─ templates/                  ← three-file templates + page templates
      ├─ scripts/                    ← render / collect / watch (pure Python stdlib)
      └─ references/                 ← data format specification
```

## FAQ

**Add plugin fails with `'git' is not recognized` or `git ls-remote ... failed`?**
That means you pasted the **GitHub URL** — installing a git URL requires git on the machine (absent by default on Windows/macOS) and GitHub access.
**Enter the npm package name instead** — no git, no GitHub:

```
dsh-plugin-control-your-development
```

**What do I need?**
DSH desktop. Rendering uses the Python bundled with DSH: standard library only, nothing to install, no network needed.

**Will it touch my code?**
No. It only reads change records; everything it writes stays inside the `dev-dashboard/` directory.

**Does it work without git?**
Yes. With git it collects changes via git; without git it falls back to file-modification-time scanning and labels the source on the page.

**Does the dashboard update itself?**
Yes, with one caveat. The AI re-renders the page every time it edits the three Markdown files ("edit, then render"), so as long as you keep working in the conversation the page is current. At init it also starts a background watcher (`watch_dashboard.py`): while that process is alive, any Markdown change re-renders the page automatically. When the watcher stops (conversation over, task reclaimed, machine restarted) the page will not change on its own — just tell the AI "update the dashboard".

**What changed in v1.2 (breaking)?**
Three cases went from a warning to a hard error (exit code 2): (1) a feature marked Verified without a verification line; (2) an evidence path that escapes the workspace (absolute, drive-lettered, UNC, or containing a parent segment); (3) `.dashboard-ignore` globs are now case-sensitive and no longer support character classes such as `[abc]` — re-check your patterns after upgrading. See `references/dashboard-format.md` (v1.2) inside the skill.

**Can I edit `index.html` directly?**
No — it's a machine artifact and hand edits get overwritten on the next render. To change content, edit the three Markdown files — usually you just tell the AI in conversation.

**Is the panel plugin required?**
No. The web page works standalone; the panel just saves you a window switch.

**macOS / Linux?**
The scripts use cross-platform APIs only and are expected to work, but so far they've been verified on Windows with DSH's bundled Python. Feedback welcome.

## License & contributing

[MIT](LICENSE) © 2026 dsh-plugin-control-your-development contributors.
Questions and suggestions via GitHub Issues; maintainer release flow in [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md).
