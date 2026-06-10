---
description: Review the current branch/PR with the code-reviewer and finance-domain-reviewer subagents.
argument-hint: "[pr-number]"
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(gh pr diff:*), Bash(gh pr view:*), Bash(git log:*), Task
---

Review the current changes for FinCore.

1. Scope the diff: if `$1` is given, use `gh pr diff $1`; otherwise `git diff main...HEAD`.
2. Launch the `code-reviewer` subagent on the diff (layering, TS strictness, security,
   a11y, Conventional Commit title, no co-author trailer).
3. If any files under `src/domain/**` changed, also launch the `finance-domain-reviewer`
   subagent.
4. Consolidate findings grouped by severity (blocker / should-fix / nit), each with
   file:line and a concrete fix. End with a clear go / no-go recommendation.
