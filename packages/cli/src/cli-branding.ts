import chalk from 'chalk';

/** Keep in sync with apps/api/src/main.ts STARTUP_SPLASH */
export const STARTUP_SPLASH = `
   █  █   █ █ █▀▄▀█ █▀█
   █  █   █ █ █ ▀ █ █▀█
   ▀▀▀  ▀▀▀ ▀ ▀   ▀ ▀ ▀
   A G E N T  S Y S T E M
`;

export function printSplash(): void {
  console.info(chalk.cyan(STARTUP_SPLASH));
}

export function printReadyLine(title: string): void {
  console.info(`   ${chalk.green('✓')} ${chalk.bold(title)}`);
}

export function printInfoRow(
  label: string,
  value: string,
  opts?: { underline?: boolean; dim?: boolean },
): void {
  const padded = label.padEnd(12, ' ');
  let styledValue = opts?.dim ? chalk.dim(value) : chalk.cyan(value);
  if (opts?.underline) {
    styledValue = chalk.cyan.underline(value);
  }
  console.info(`   ${chalk.gray('↳')} ${chalk.white(padded)} ${styledValue}`);
}

export function printCommandRow(name: string, description: string): void {
  const padded = name.padEnd(10, ' ');
  console.info(`       ${chalk.cyan(padded)} ${chalk.dim(description)}`);
}

/** Strip ANSI codes for test assertions */
export function stripAnsi(text: string): string {
  const esc = String.fromCharCode(27);
  return text.replace(new RegExp(`${esc}\\[[0-9;]*m`, 'g'), '');
}
