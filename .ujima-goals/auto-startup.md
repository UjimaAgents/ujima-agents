# Auto-Startup for Ujima Daemon

**Goal:** When a user runs `ujima start` for the first time (after this feature ships), Ujima automatically registers itself to start on system boot. On every subsequent boot, the full stack (API daemon + web UI) starts silently in the background, always available.

---

## Design

### First `ujima start` flow
1. User runs `ujima start` (normal, interactive mode — the current behavior)
2. After starting the daemon, CLI checks `isStartupRegistered()`
3. If **not** registered, silently registers Ujima for auto-startup on boot
4. Prints: `✓ Registered Ujima to start automatically on boot`
5. On next system startup, the platform runs `ujima start --background` automatically

### Background mode
- `ujima start --background` starts API + web UI as detached child processes
- stdout/stderr redirected to `~/.ujima/logs/api.log` and `~/.ujima/logs/web.log` with rotation
- PID file written to `~/.ujima/ujima.pid` for `ujima stop`
- Prints: `Ujima started in background (PID: X)` — does not block terminal

### `ujima stop` command
- Reads PID from `~/.ujima/ujima.pid`
- Sends SIGTERM to children (API + web)
- Cleans up PID file

### Platform-specific mechanisms
| Platform | Mechanism | Target path |
|----------|-----------|-------------|
| macOS    | launchd plist | `~/Library/LaunchAgents/com.ujima.agents.plist` |
| Linux    | systemd user service | `~/.config/systemd/user/ujima.service` |
| Windows  | Registry Run key | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` |

### Unregistration
- `ujima start --unregister-startup` removes the auto-startup entry
- `ujima update` preserves the registration (re-registers if path changes)
- On `npm uninstall -g @ujima/agents`, printed cleanup instructions

---

## Task Breakdown

### Task 1: Create `packages/cli/src/auto-startup.ts` module
- Platform detection (macOS, Linux, Windows)
- Functions: `registerStartup(binaryPath)`, `unregisterStartup()`, `isStartupRegistered()` — with return type `{ success: boolean; error?: string }`
- For launchd: write plist, run `launchctl load`
- For systemd: write unit file, run `systemctl --user daemon-reload && systemctl --user enable`
- For Windows: write to Registry Run key via `reg add`
- Create log directory: `~/.ujima/logs/`

### Task 2: Add `--background` flag to `ujima start` (`cmdStartPackaged`)
- Parse `--background` / `-b` flag
- In background mode:
  - Redirect child stdout/stderr to log files
  - Write PID to `~/.ujima/ujima.pid`
  - Detach — don't wait for children, don't set up signal handlers
- In normal mode: keep current behavior (blocking, inherit stdio)

### Task 3: Integrate auto-startup into `cmdStart`
- After successful start, call `registerStartup()` if not already registered
- Handle `--register-startup` / `--unregister-startup` flags explicitly
- Print confirmation/error

### Task 4: Add `ujima stop` command
- Read `~/.ujima/ujima.pid`
- Kill process group with SIGTERM
- Wait briefly, SIGKILL if still alive
- Remove PID file
- Print stopped confirmation

### Task 5: Update CLI help and tests
- Update `printCommandHelp('start')` with `--background`, `--register-startup`, `--unregister-startup`
- Add `stop` to command listing in `printUsage()`
- Add `printCommandHelp('stop')`
- Write tests for auto-startup.ts (mocked fs/exec)

---

## Files changed
| File | Change |
|------|--------|
| `packages/cli/src/auto-startup.ts` | **NEW** — platform auto-startup module |
| `packages/cli/src/main.ts` | Add `--background`, `--register-startup`, `--unregister-startup` flags; add `cmdStop`; integrate auto-startup in `cmdStart` |
| `packages/cli/src/start-supervisor.ts` | Minor: no changes needed, background handles its own lifecycle |
