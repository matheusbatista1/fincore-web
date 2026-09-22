#!/usr/bin/env node
/**
 * PreToolUse(Bash) guard.
 *
 * Golden rule #1: the user is the SOLE author of every commit and PR. This hook blocks
 * any `git commit` (including `git -C dir commit`) and any `gh pr create|edit|merge`
 * whose message or body credits Claude/Anthropic as author or co-author, or adds a
 * "Generated with Claude" line.
 *
 * Receives the tool call as JSON on stdin; exits 2 to block (stderr is shown to
 * Claude), 0 to allow. Reads stdin via the async stream so it works on Windows.
 */
import process from "node:process";

const FORBIDDEN = [
  /co-authored-by:\s*claude/i,
  /co-authored-by:[^\n]*anthropic/i,
  /co-authored-by:[^\n]*noreply@anthropic/i,
  /generated\s+with\s+\[?\s*claude/i,
  /🤖\s*generated\s+with/i,
];

const TRIGGER = /\bgit\b[^|;&]*\bcommit\b|\bgh\s+pr\s+(create|edit|merge)\b/;

function decide(command) {
  if (typeof command !== "string" || !TRIGGER.test(command)) return 0;
  if (FORBIDDEN.some((re) => re.test(command))) {
    console.error(
      "Blocked by .claude/hooks/block-coauthor.mjs:\n" +
        "Commits and PRs must credit only the user. Remove any 'Co-Authored-By: Claude' or " +
        "'Generated with Claude Code' line from the commit message or PR body (CLAUDE.md golden rule #1).",
    );
    return 2;
  }
  return 0;
}

// No piped payload (e.g. invoked interactively) → allow.
if (process.stdin.isTTY) {
  process.exit(0);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  let command = "";
  try {
    // Strip a leading BOM if some shell added one before the JSON payload.
    command = JSON.parse(raw.replace(/^﻿/, ""))?.tool_input?.command ?? "";
  } catch {
    process.exit(0);
  }
  process.exit(decide(command));
});
