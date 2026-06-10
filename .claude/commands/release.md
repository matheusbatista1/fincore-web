---
description: Open the merge PR to main, summarizing changes from Conventional Commits (no version bump).
allowed-tools: Read, Grep, Glob, Bash(git log:*), Bash(git diff:*), Bash(git push:*), Bash(gh pr create:*), Bash(gh pr view:*)
---

Prepare the release PR for the current `feat|fix|...` branch into `main`.

1. Ensure the branch is pushed (`git push -u origin HEAD`).
2. Summarize the Conventional Commits since `main` into PR notes grouped by type
   (Features / Fixes / Refactors / Chores).
3. Open a PR with `gh pr create`, filling the PR template checklist, a Conventional
   Commit title, and the generated notes. Link any related issues.
4. Report the PR URL and the Vercel preview once available.

Authorship rule: the PR and its commits are authored solely by the user — never add
a Claude/Anthropic co-author or "Generated with Claude" line. No version bump
(solo project; Conventional Commits keep the door open for automation later).
