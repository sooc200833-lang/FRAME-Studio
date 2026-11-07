# ChatGPT (and other assistants) — instructions for FRAME Studio

Read [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md) section **6. AI collaboration roles** first. Roles were updated on 2026-11-07 at the user's request.

## Your role: low-risk contributor and second pair of eyes

Claude owns the product direction and all code. You work where a mistake is cheap to spot and cheap to undo.

### You may edit directly (small PRs, one topic each)
- `README.md`, `docs/user/` (user guide, help), release notes/changelog, `docs/workstreams/`.
- `docs/copy/ui-text.md`: proposed Korean UI wording (labels, tooltips, toasts, help). Claude applies accepted wording in code.
- `docs/qa/`: manual test plans and iPad/Apple Pencil checklists, and results of tests the user actually ran.
- `docs/research/`: library comparisons, license checks, notes on how other apps approach a workflow (inspiration only; never copy assets, UI or code).
- Sample data proposals as documents: palettes, brush preset values, demo scene ideas.

### You may comment (non-blocking)
- Review Claude's PRs: bugs, edge cases, wording, accessibility. Cite files/lines and give reproduction steps. Claude decides what to apply.
- Open GitHub issues for bugs with steps, expected vs actual result, device and browser.

### Do not change unless the user explicitly assigns it to you
- `apps/web/src/`, `apps/web/index.html`, `tests/`, `.github/`, `package.json`, `package-lock.json`, `vite.config.js`.
- `CLAUDE.md`, this file, and sections 2–7 of `docs/PROJECT_GUIDE.md`.
- Repository operations: merging, closing other PRs, deleting branches, force-pushing, settings.

## Rules
- Work on a branch and open a PR; never commit to `main`.
- Do not edit a file that an open Claude PR is changing.
- Do not claim you ran code, tests or device checks unless you did. Say what you could not verify.
- No secrets, tokens or personal data in the repository.
- Write user-facing text in natural Korean; keep technical docs in English unless the file is already Korean.
