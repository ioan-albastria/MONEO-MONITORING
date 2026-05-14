# =====================================================================
# [ALWAYS] A. ORIENTATION
# =====================================================================
You are working on the MONEO sensor dashboard. Read ./CLAUDE.md first,
then the area-specific CLAUDE.md(s) for the folders your task touches:
- frontend work → ./frontend/CLAUDE.md
- backend work  → ./backend/CLAUDE.md
- cross-cutting → both
Skim, don't re-read the codebase from scratch. The CLAUDE.md files
exist precisely so you don't have to.

# =====================================================================
# [ALWAYS] B. SCOPE
# =====================================================================
TASK: <describe the feature or change in 1–3 sentences>

IN SCOPE:
- <bullet>
- <bullet>

EXPLICITLY OUT OF SCOPE:
- <name the most tempting adjacent changes to head them off>

# =====================================================================
# [ALWAYS] C. CODE CONVENTIONS
# =====================================================================
Follow the conventions documented in the CLAUDE.md files. Specifically:
- Match the patterns used by similar existing code. If adding a
  service, look at an existing service in the same folder first.
- Do not introduce a new library, framework, or architectural pattern
  without flagging it for approval before writing.
- File naming, folder structure, and module boundaries follow the
  current project — do not reinvent.

# =====================================================================
# [SITUATIONAL] D. CLARIFICATIONS POLICY
# Include for ambiguous or open-ended tasks.
# =====================================================================
If any part of this task is ambiguous after reading the docs and a
quick code skim, ASK before writing. Pause specifically if:
- The task could be implemented multiple sensible ways and the choice
  affects more than one file.
- The feature requires data or endpoints not documented in the backend
  CLAUDE.md.
- The visual or UX behavior isn't described in the task or in the spec.
Don't ask about trivial defaults (variable names, log levels); pick
sensibly and note the choice in the handoff.

# =====================================================================
# [SITUATIONAL] E. BACKEND CONSTRAINT
# Include for any frontend-only work. OMIT only when the task
# explicitly changes the backend.
# =====================================================================
Do not modify any file under ./backend in this session. If your task
appears to require a backend change, STOP and flag it — we'll discuss
before proceeding.

# =====================================================================
# [SITUATIONAL] F. TESTING
# Include for any behavior-affecting change. Omit for pure refactors
# or visual-only changes (still run the existing suite to confirm no
# regression — that's free).
# =====================================================================
For every new or changed behavior, add or update a Playwright test in
./frontend/e2e/. Tests describe expected behavior, not implementation;
they should pass when the feature is correct and fail when it's not.
Run the relevant tests after each meaningful change, not just at the
end. For pure refactors or visual-only changes, run the existing suite
to confirm no regression; new tests are optional.

# =====================================================================
# [SITUATIONAL] G. DOCUMENTATION UPDATE
# Include if your task changes anything that's documented in any
# CLAUDE.md — endpoints, conventions, file layout, gotchas, deviations.
# =====================================================================
At the end of the session, update the relevant CLAUDE.md file(s) so
they reflect the new state of the code. Stale docs mislead the next
agent — worse than no docs. Update concisely: add a line, edit a path,
remove an obsolete bullet. List your doc changes in the handoff block.

# =====================================================================
# [SITUATIONAL] H. ROLLBACK DISCIPLINE
# Include for any task that touches multiple files or styling.
# =====================================================================
Work iteratively: implement, verify, commit, move on. Don't change
five files then verify. If a step breaks something you can't quickly
fix, REVERT that step and try a smaller change rather than pushing
through. Every reverted attempt is cheaper than a tangled diff to
unwind later.

# =====================================================================
# [ALWAYS] I. WORKFLOW
# =====================================================================
- Use a TodoList. One todo per logical step.
- For non-trivial tasks, sketch your file plan first and PAUSE for my
  approval before writing code.
- Run the relevant tests / build after each meaningful change.

# =====================================================================
# [ALWAYS] J. HANDOFF
# =====================================================================
At the end of the session, write a fenced markdown "Current state"
block, under 15 lines, covering:
- what shipped (1-2 lines)
- files changed (list)
- any deviation from the plan and why
- any new TODOs or gotchas added to the CLAUDE.md files
- anything unfinished and what blocks it
I'll paste this into the next session if the work continues.