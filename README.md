# Task Harbor

A Linux desktop app that brings terminals, tasks and AI agents together in one workspace. Dark UI; real interactive terminals that keep running when you switch tabs or close the main window.

## Run and package

### Install from the `.deb` (Ubuntu/Debian, x86_64)

Build with `npm run dist:deb`. The output is `release/deb/Task-Harbor-0.1.5-amd64.deb`; it uses its own build directory so it does not overwrite a running AppImage/unpacked build.

```bash
sudo apt install ./release/deb/Task-Harbor-0.1.5-amd64.deb
```

The package contains the app, Electron, the native terminal module, the icon and a **Task Harbor** menu entry. The target machine does not need Node.js/npm or the source tree. The app is installed to `/opt/Task Harbor`, provides the `task-harbor` command, and configures sandbox/AppArmor with electron-builder's standard script. Installing does not launch the app. Once existing tasks are done, quit completely and reopen the installed build via `task-harbor` or the menu. Data still lives in `~/.config/Task Harbor`.

If you previously used `npm run install:desktop`, the personal shortcut will shadow the `.deb` menu entry. **After the `.deb` installs successfully**, rename the two old shortcuts to keep a backup:

```bash
mv ~/.local/share/applications/dev.taskharbor.desktop ~/.local/share/applications/dev.taskharbor.desktop.bak
mv "$(xdg-user-dir DESKTOP)/Task Harbor.desktop" "$(xdg-user-dir DESKTOP)/Task Harbor.desktop.bak"
```

Then open it from the application menu; you can pin it to the dock. Skip the rename step if you have no old shortcuts. Update by installing a newer `.deb`; uninstall with `sudo apt remove task-harbor` (personal data is kept).

### Run from source / AppImage

Requires Node.js 22.12+, npm, a graphical Linux session, a Bash/Zsh-compatible shell, and a C/C++ toolchain plus Python 3 to build `node-pty`. Electron needs the GTK, NSS, ALSA and GBM system libraries; desktop Linux usually has them.

```bash
npm install
npm run dev
```

`dev` and `start` check for and download the Electron binary if missing; the first download needs network access. The dev server uses port `5187`.

`postinstall` rebuilds `node-pty` for the installed Electron version. If you change Electron or hit a native module ABI error, run `npm run postinstall`.

```bash
npm run build
npm start
npm run dist
```

The AppImage is at `release/0.1.5/Task-Harbor-0.1.5-x86_64.AppImage`:

```bash
chmod +x release/0.1.5/Task-Harbor-0.1.5-x86_64.AppImage
./release/0.1.5/Task-Harbor-0.1.5-x86_64.AppImage
```

AppImage requires FUSE 2. On the current Ubuntu machine FUSE is missing, Chromium user namespaces are blocked and there is no valid SUID sandbox. You can run the dev build with `npm run dev -- --noSandbox`, the production build with `npm start -- --noSandbox`, or use the unpacked directory, which does not need FUSE:

```bash
./release/0.1.5/linux-unpacked/task-harbor --no-sandbox
```

If you only have the AppImage, `cd` to where you want it extracted, run `/path/to/Task-Harbor-0.1.5-x86_64.AppImage --appimage-extract`, then open `./squashfs-root/AppRun --no-sandbox`. The bundled AppImage runtime does not support `--appimage-extract-and-run`.

`--no-sandbox` is only an opt-in workaround for this environment and disables the Chromium sandbox. By default the app keeps the sandbox on; the preload is isolated and the renderer has no direct Node.js access.

## Usage

To add a desktop icon and a **Task Harbor** entry in the application menu:

```bash
npm run install:desktop -- --no-sandbox
```

This suits the current Ubuntu machine and does not launch the app. Machines that support the Chromium sandbox can drop `-- --no-sandbox`. Then press **Super**, search for **Task Harbor** and open it, or double-click the desktop icon. To pin it to the dock, right-click the icon in the menu and choose **Add to Favorites**.

Version 0.1.5 is packaged separately so it does not overwrite the running app. After updating the shortcut, quit completely and reopen once current tasks are finished to get the new version.

The shortcut points to `release/0.1.5/linux-unpacked/task-harbor`; keep the project directory in place. If you move the project, rerun the shortcut install command.

- Create groups, set their name/color and reorder them in the sidebar. Each group shows a session count; running status is shown per terminal. When deleting a group that has sessions, choose a receiving group to keep processes intact; deleting the last group recreates “General”.
- Create a terminal with a task name and working directory; leave the command empty for a shell, or enter a command to run. Choose the **AI agent** type to mark CLI agents installed and logged in on this machine.
- Save command templates for quick reuse; the pencil button on each terminal opens its full name, session type, group, directory and startup command. If the session is running, the new directory/command is saved for the next run; the app does not stop the current task.
- Pick a session from the overview to open its terminal; use the group/terminal tree on the left or split the screen to work with two sessions at once. While the app is open, each group remembers its last terminal and split pane: switching groups and coming back reopens the same session, keeping half-typed input and running processes. A group never opened before selects its first session; an empty group shows the overview. The **Dashboard** button opens the overview list.
- **Open in separate window** keeps the process and terminal screen intact. Closing the separate window returns the session to the main window.
- Closing the main window keeps tasks running in the background. Reopen from the tray or launch the app again; only one app instance manages the workspace.
- If the desktop has no tray, launch the app again to bring back the existing window. Test this mode with `TASK_HARBOR_NO_TRAY=1 npm start`.
- The power button in the sidebar or the tray's **Quit completely** stops all sessions and their child processes; the app asks for confirmation if sessions are still running. **Stop session** also asks before ending a task.

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+T` | New terminal |
| `Ctrl+Shift+P` | Find and jump to a session |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous session |
| `↑` / `↓`, `←` / `→` in the tree | Select item, collapse/expand group |
| `Alt+↑` / `Alt+↓` in the tree | Move group or terminal |
| `F2` in the tree | Edit group or terminal |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copy selection / paste into terminal |
| `Ctrl+C` | Send interrupt to the terminal command |
| `Ctrl+Shift+Q` | Quit completely |

Status is shown with both icon and text: starting, running, finished, stopped or error. Command sessions follow the command's lifecycle and report an exit code; interactive shells follow the shell's lifecycle. The AI agent label does not guess an agent's progress or whether it is waiting for input. This version does not adopt terminals opened outside the app or orchestrate agents.

## Group tree and terminal editing

The sidebar shows groups at the top level with terminals/AI agents beneath. Click the arrow to collapse or expand a group; the visible terminal and its processes are unaffected. Collapse state and order persist across restarts.

Drag groups up/down to reorder. Drag a terminal onto a group, or before/after another terminal; a highlight line marks the drop position. Arrow buttons appear on the hovered/selected row so you can reorder while keeping the list in view. The pencil button edits a session; the **+** button creates a terminal in that group.

## Performance with many sessions

All terminals share a single process scan every 300 ms. When stopping a session the app still performs a fresh scan to find child processes and verify PID identity; stopping one session does not affect others. The watch list also drops child processes that have exited.

Re-measure with `npm run benchmark:sessions -- 20`. It runs 20 test terminals in a temp directory using Electron's Node runtime, without opening windows or touching your personal workspace. A 6-second run on the dev machine showed scans drop from 400 to 20 and manager-process CPU drop from 38.03% to 5.58%. This measures idle terminals only, excluding the renderer and the CPU of commands/agents; results vary by machine and system load.

## Transparent background

Click **Appearance** next to **New terminal** in the left sidebar and drag **Background transparency** between 0–100%. Terminals use a black `#080808` background, defaulting to **0% transparent** (solid) for readability. **Default 0%** restores the initial value. Only the background changes; text, cursor and terminal content stay sharp.

The chosen level is saved with the workspace and applies to both the main window and detached terminals. Changes take effect immediately without restarting terminals or running commands. Workspaces without appearance settings default to 0%; customized values are preserved.

## Data storage and recovery

Groups, templates, session info and layout are stored in `workspace.json` in Electron's `userData` directory, by default `$XDG_CONFIG_HOME/Task Harbor` or `~/.config/Task Harbor`. Set a custom directory with `TASK_HARBOR_DATA_DIR=/absolute/path`.

The file is written via a temp file and then renamed, with `0600` permissions. If the configuration is corrupt or invalid, the app keeps the old file as `workspace.json.corrupt-<timestamp>` and shows a warning. To recover manually, quit completely first, back up the data directory, then fix/replace `workspace.json` with a valid copy.

After a restart, sessions that were running are marked stopped; commands only run when you explicitly restart them. Terminal output lives in memory, capped at about 5,000 scrollback lines per session, and is not kept after the app quits. Tasks are not guaranteed to survive an app crash, a forced kill or a machine reboot. Commands and paths in the configuration are stored as plain text; do not put passwords directly in command templates.

## Architecture and testing

The Electron main process manages PTYs (`node-pty`), the Linux process tree, the workspace and windows. React talks only through a typed preload API, and IPC input is validated. `xterm.js` renders terminals; `@xterm/headless` keeps ANSI state and history so sessions can be switched, split or detached without restarting the task. Each snapshot carries a sequence number so the renderer stitches it correctly onto the subsequent output stream.

```bash
npm run typecheck
npm test
npm run test:sessions
npm run test:e2e
npm run dist
npm run test:packaged
```

Storage tests use the Node test runner and cover editing/reordering sessions, persisting tree state and config validation. Playwright covers mouse drag-and-drop, tree keyboard shortcuts, editing a running session and applying the new config on restart, and PID preservation when collapsing/expanding groups. Session tests run real PTYs under Electron's Node runtime to match the native ABI: Unicode, ANSI colors, `Ctrl+C`, resize, bounded history, exit codes, bad directory/shell, child-process termination, restart/delete, restore without auto-run, and ten sessions across three groups. UI tests use Playwright to launch Electron; they need a desktop display, or `xvfb-run -a npm run test:e2e` in CI.

`test:packaged` extracts the AppImage to a temp directory and checks the PTY, Unicode input, and quitting and reopening from the tray if the desktop has a StatusNotifierWatcher. Electron tests use `--no-sandbox` for compatibility with the current test machine; product code never disables the sandbox on its own.

`npm run test:deb` runs the same checks against the extracted `.deb` without installing it. Use `TASK_HARBOR_NO_TRAY=1 xvfb-run -a npm run test:deb` to run in a virtual display and avoid opening windows on your working desktop.

Commands you run have the permissions of the current Linux user. The app works entirely locally and needs no server or account.
