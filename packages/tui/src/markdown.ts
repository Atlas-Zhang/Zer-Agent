import { bold, colorize, dim, stripAnsi } from "./theme.js";

export function renderMarkdownToTerminal(markdown: string, width = 100): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (isTableStart(lines, index)) {
      const tableLines: string[] = [];
      while (index < lines.length && isTableLine(lines[index] ?? "")) {
        tableLines.push(lines[index] ?? "");
        index += 1;
      }
      index -= 1;
      output.push(...renderTable(tableLines, width));
      continue;
    }

    output.push(renderMarkdownLine(line));
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function renderMarkdownLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) {
    return "";
  }

  if (/^---+$/.test(trimmed)) {
    return dim("─".repeat(48));
  }

  const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
  if (headingMatch) {
    const [, hashes, content] = headingMatch;
    const formatted = applyInlineFormatting(content);
    if (hashes.length <= 2) {
      return bold(colorize("cyan", stripAnsi(formatted).toUpperCase()));
    }
    return bold(colorize("cyan", stripAnsi(formatted)));
  }

  const bulletMatch = trimmed.match(/^([-*])\s+(.*)$/);
  if (bulletMatch) {
    return `${colorize("green", "•")} ${applyInlineFormatting(bulletMatch[2] ?? "")}`;
  }

  const orderedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
  if (orderedMatch) {
    return `${colorize("green", `${orderedMatch[1]}.`)} ${applyInlineFormatting(orderedMatch[2] ?? "")}`;
  }

  return applyInlineFormatting(line);
}

function applyInlineFormatting(value: string): string {
  let formatted = value;
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, (_, text: string) => bold(text));
  formatted = formatted.replace(/\*([^*\n]+)\*/g, (_, text: string) => dim(text));
  formatted = formatted.replace(/`([^`]+)`/g, (_, text: string) => colorize("yellow", text));
  return formatted;
}

function isTableStart(lines: string[], index: number): boolean {
  return isTableLine(lines[index] ?? "") && isTableDivider(lines[index + 1] ?? "");
}

function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|");
}

function isTableDivider(line: string): boolean {
  return /^\|(?:\s*:?-+:?\s*\|)+$/.test(line.trim());
}

function renderTable(lines: string[], width: number): string[] {
  const rows = lines
    .filter((line, index) => !(index === 1 && isTableDivider(line)))
    .map(parseTableRow);

  if (rows.length === 0) {
    return [];
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const widths = new Array<number>(columnCount).fill(0);
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, Math.min(stripAnsi(cell).length, 32));
    });
  }

  fitTableWidths(widths, width);
  const separator = dim(`+${widths.map((cellWidth) => "-".repeat(cellWidth + 2)).join("+")}+`);

  return rows.flatMap((row, index) => {
    const normalized = widths.map((cellWidth, cellIndex) => padCell(applyInlineFormatting(row[cellIndex] ?? ""), cellWidth));
    const renderedRow = `| ${normalized.join(" | ")} |`;
    if (index === 0) {
      return [separator, renderedRow, separator];
    }
    return [renderedRow, index === rows.length - 1 ? separator : ""].filter(Boolean);
  });
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function padCell(value: string, width: number): string {
  const rawLength = stripAnsi(value).length;
  if (rawLength >= width) {
    return truncateCell(value, width);
  }
  return `${value}${" ".repeat(width - rawLength)}`;
}

function truncateCell(value: string, width: number): string {
  const raw = stripAnsi(value);
  if (raw.length <= width) {
    return value;
  }
  const shortened = raw.slice(0, Math.max(0, width - 1)).trimEnd();
  return `${shortened}…`;
}

function fitTableWidths(widths: number[], totalWidth: number): void {
  const maxContentWidth = Math.max(20, totalWidth - (widths.length * 3) - 1);
  let current = widths.reduce((sum, cellWidth) => sum + cellWidth, 0);

  while (current > maxContentWidth) {
    let adjusted = false;
    for (let index = 0; index < widths.length && current > maxContentWidth; index += 1) {
      if ((widths[index] ?? 0) > 12) {
        widths[index] -= 1;
        current -= 1;
        adjusted = true;
      }
    }
    if (!adjusted) {
      break;
    }
  }
}
