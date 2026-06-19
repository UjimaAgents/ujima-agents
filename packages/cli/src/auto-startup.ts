import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

export interface StartupResult {
  success: boolean;
  error?: string;
}

function resolveUjimaCommand(): [string, string] {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    throw new Error('Cannot determine the ujima CLI script path');
  }
  return [process.execPath, scriptPath];
}

function homeDir(): string {
  const fromEnv = process.env.UJIMA_HOME;
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  return join(homedir(), '.ujima');
}

export function logDir(): string {
  return join(homeDir(), 'logs');
}

export function pidFilePath(): string {
  return join(homeDir(), 'ujima.pid');
}

function ensureLogDir(): void {
  mkdirSync(logDir(), { recursive: true });
}

// ── macOS (launchd) ──────────────────────────────────────────────

const LAUNCHD_LABEL = 'com.ujima.agents';

function darwinPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', 'com.ujima.agents.plist');
}

function buildDarwinPlist(cmd: string[], stdoutPath: string, stderrPath: string): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">');
  lines.push('<plist version="1.0">');
  lines.push('  <dict>');
  lines.push('    <key>Label</key>');
  lines.push('    <string>' + LAUNCHD_LABEL + '</string>');
  lines.push('    <key>ProgramArguments</key>');
  lines.push('    <array>');
  for (const arg of cmd) {
    lines.push('      <string>' + escapeXml(arg) + '</string>');
  }
  lines.push('    </array>');
  lines.push('    <key>RunAtLoad</key>');
  lines.push('    <true/>');
  lines.push('    <key>KeepAlive</key>');
  lines.push('    <false/>');
  lines.push('    <key>StandardOutPath</key>');
  lines.push('    <string>' + escapeXml(stdoutPath) + '</string>');
  lines.push('    <key>StandardErrorPath</key>');
  lines.push('    <string>' + escapeXml(stderrPath) + '</string>');
  lines.push('  </dict>');
  lines.push('</plist>');
  return lines.join('\n');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSystemdUnit(cmd: string[]): string {
  const execStart = cmd
    .map((s) => (s.includes(' ') ? '"' + s + '"' : s))
    .join(' ');
  const lines: string[] = [];
  lines.push('[Unit]');
  lines.push('Description=Ujima Agents Daemon');
  lines.push('After=network.target');
  lines.push('');
  lines.push('[Service]');
  lines.push('Type=simple');
  lines.push('ExecStart=' + execStart);
  lines.push('Restart=on-failure');
  lines.push('RestartSec=10');
  lines.push('');
  lines.push('[Install]');
  lines.push('WantedBy=default.target');
  return lines.join('\n');
}

function ensureDarwinRegistered(): StartupResult {
  ensureLogDir();
  const [nodeBin, scriptPath] = resolveUjimaCommand();
  const cmd = [nodeBin, scriptPath, 'start', '--background'];
  const plistPath = darwinPlistPath();
  const stdoutPath = join(logDir(), 'launchd-stdout.log');
  const stderrPath = join(logDir(), 'launchd-stderr.log');
  const content = buildDarwinPlist(cmd, stdoutPath, stderrPath);
  try {
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
    writeFileSync(plistPath, content, 'utf8');
    execSync('launchctl load "' + plistPath + '"', { stdio: 'ignore', timeout: 10_000 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function ensureDarwinUnregistered(): StartupResult {
  const plistPath = darwinPlistPath();
  try {
    try {
      execSync('launchctl unload "' + plistPath + '"', { stdio: 'ignore', timeout: 10_000 });
    } catch {
      // may not be loaded — fine
    }
    if (existsSync(plistPath)) unlinkSync(plistPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function isDarwinRegistered(): boolean {
  const plistPath = darwinPlistPath();
  if (!existsSync(plistPath)) return false;
  try {
    execSync('launchctl list ' + LAUNCHD_LABEL, { stdio: 'pipe', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

// ── Linux (systemd user) ─────────────────────────────────────────

function systemdUnitPath(): string {
  return join(homedir(), '.config', 'systemd', 'user', 'ujima.service');
}

function ensureLinuxRegistered(): StartupResult {
  ensureLogDir();
  const [nodeBin, scriptPath] = resolveUjimaCommand();
  const cmd = [nodeBin, scriptPath, 'start', '--background'];
  const unitPath = systemdUnitPath();
  const content = buildSystemdUnit(cmd);
  try {
    mkdirSync(join(homedir(), '.config', 'systemd', 'user'), { recursive: true });
    writeFileSync(unitPath, content, 'utf8');
    execSync('systemctl --user daemon-reload', { stdio: 'ignore', timeout: 15_000 });
    execSync('systemctl --user enable ujima.service', { stdio: 'ignore', timeout: 15_000 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function ensureLinuxUnregistered(): StartupResult {
  const unitPath = systemdUnitPath();
  try {
    try {
      execSync('systemctl --user disable ujima.service', { stdio: 'ignore', timeout: 10_000 });
    } catch {
      // may not be enabled — fine
    }
    if (existsSync(unitPath)) unlinkSync(unitPath);
    execSync('systemctl --user daemon-reload', { stdio: 'ignore', timeout: 10_000 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function isLinuxRegistered(): boolean {
  const unitPath = systemdUnitPath();
  if (!existsSync(unitPath)) return false;
  return true;
}

// ── Windows (Registry Run key) ───────────────────────────────────

function buildWindowsCommand(): string {
  const [nodeBin, scriptPath] = resolveUjimaCommand();
  return [nodeBin, scriptPath, 'start', '--background']
    .map((s) => (s.includes(' ') ? '"' + s + '"' : s))
    .join(' ');
}

function ensureWindowsRegistered(): StartupResult {
  ensureLogDir();
  try {
    const execStr = buildWindowsCommand();
    const regCmd =
      'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Ujima Agents" /t REG_SZ /d "' +
      execStr +
      '" /f';
    execSync(regCmd, { stdio: 'ignore', timeout: 10_000 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function ensureWindowsUnregistered(): StartupResult {
  try {
    execSync(
      'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Ujima Agents" /f',
      { stdio: 'ignore', timeout: 10_000 },
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function isWindowsRegistered(): boolean {
  try {
    execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Ujima Agents"',
      { stdio: 'pipe', timeout: 5_000 },
    );
    return true;
  } catch {
    return false;
  }
}

// ── Public API ───────────────────────────────────────────────────

export function registerStartup(): StartupResult {
  const plat = platform();
  switch (plat) {
    case 'darwin':
      return ensureDarwinRegistered();
    case 'linux':
      return ensureLinuxRegistered();
    case 'win32':
      return ensureWindowsRegistered();
    default:
      return { success: false, error: 'Unsupported platform: ' + plat };
  }
}

export function unregisterStartup(): StartupResult {
  const plat = platform();
  switch (plat) {
    case 'darwin':
      return ensureDarwinUnregistered();
    case 'linux':
      return ensureLinuxUnregistered();
    case 'win32':
      return ensureWindowsUnregistered();
    default:
      return { success: false, error: 'Unsupported platform: ' + plat };
  }
}

export function isStartupRegistered(): boolean {
  const plat = platform();
  switch (plat) {
    case 'darwin':
      return isDarwinRegistered();
    case 'linux':
      return isLinuxRegistered();
    case 'win32':
      return isWindowsRegistered();
    default:
      return false;
  }
}
