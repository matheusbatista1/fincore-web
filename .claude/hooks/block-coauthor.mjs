#!/usr/bin/env node
/**
 * PreToolUse(Bash) guard.
 *
 * Golden rule #1: the user is the SOLE author of every commit. This hook blocks
 * any `git commit` whose message credits Claude/Anthropic as author or co-author,
 * or that adds a "Generated with Claude" line.
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

function decide(command) {
  if (typeof command !== "string" || !/\bgit\s+commit\b/.test(command)) return 0;
  if (FORBIDDEN.some((re) => re.test(command))) {
    console.error(
      "Blocked by .claude/hooks/block-coauthor.mjs:\n" +
        "Commits must credit only the user. Remove any 'Co-Authored-By: Claude' or " +
        "'Generated with Claude Code' line from the commit message (CLAUDE.md golden rule #1).",
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
