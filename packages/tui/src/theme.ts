const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  magenta: "\u001b[35m",
  blue: "\u001b[34m",
  gray: "\u001b[90m"
};

export type ThemeColor = keyof typeof ANSI;

export function colorize(color: ThemeColor, value: string): string {
  return `${ANSI[color]}${value}${ANSI.reset}`;
}

export function bold(value: string): string {
  return `${ANSI.bold}${value}${ANSI.reset}`;
}

export function dim(value: string): string {
  return `${ANSI.dim}${value}${ANSI.reset}`;
}

export function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}
