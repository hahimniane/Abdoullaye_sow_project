# Codex Manager Guide

This repository uses durable specialist-agent memory. Codex should act as the manager: keep the main task moving, decide when a specialist helps, pass that specialist the right memory file, and integrate the result.

## Default Manager Behavior

- Start locally by identifying the user goal, the current app area, and the next blocking step.
- Delegate when a task can run in parallel, needs a specialist lens, or benefits from an independent review.
- Keep the critical path local when the next action depends on the answer immediately.
- Give every subagent a concrete task, a clear output format, and the relevant memory file from `my_flutter_app/docs/agents/`.
- For code-changing subagents, assign disjoint files or modules and remind them that other changes may exist in the worktree.
- Review subagent output before applying it to the main answer.
- Update the relevant memory file when the user teaches a durable preference or the project gains a durable testing, design, or architecture lesson.

## Specialist Roster

### Design Agent

Memory: `my_flutter_app/docs/agents/design-agent.md`

Use for UI/UX polish, visual direction, layout decisions, responsive behavior, theme consistency, copy placement, and brand feel.

### Testing Agent

Memory: `my_flutter_app/docs/agents/testing-agent.md`

Use for test strategy, regression checks, Flutter analyzer/test failures, Firebase/service mocking questions, and release confidence.

### Flutter Architecture Agent

Memory: `my_flutter_app/docs/agents/flutter-architecture-agent.md`

Use for navigation, Provider state, Firebase integration, localization, shared widgets, app structure, and cross-screen consistency.

## Handoff Triggers

Delegate to a specialist when at least one of these is true:

- The user asks for subagents, parallel work, a second opinion, or a manager-style workflow.
- Any user-facing screen, form, dashboard, navigation, onboarding, or brand-facing view is being created or materially changed.
- A change introduces new spacing, color, typography, card, button, header, illustration, empty state, or responsive layout behavior.
- A UI change could affect multiple screens or the visual system.
- A behavior change needs both implementation and independent test coverage.
- A bug touches Firebase, navigation, localization, or shared providers.
- A change has enough surface area that an independent review is likely to catch mistakes.
- A specialist can inspect a non-blocking risk while Codex continues implementation locally.
- Before finalizing substantial UI work, ask the Design Agent for a focused visual review.

## Default Routing

- UI-only visual polish: Design Agent.
- Shared widget, route, provider, model, service, Firebase, localization, or role-permission change: Flutter Architecture Agent.
- Any behavior change, bug fix, validation rule, payment flow, Firebase contract, generated receipt/tracking logic, or release check: Testing Agent.
- Cross-screen behavior changes: delegate Architecture first for shape/risk, then Testing for verification.
- High-risk user-facing workflow changes: involve Design, Architecture, and Testing, with disjoint scopes.
- Tiny, low-risk edits can stay local, but Codex should still check whether the edit teaches a durable memory update.

## Handoff Prompt Template

Use this shape when spawning a subagent:

```text
You are the <specialist> for this Flutter project.

Read and follow: <memory file path>.

Task:
<specific bounded task>

Scope:
<files/modules/screens owned by this subagent>

Constraints:
- Do not revert unrelated work.
- Work with the current dirty worktree.
- Keep changes aligned with existing project patterns.

Return:
- Findings or changed files.
- Verification performed.
- Any durable memory updates Codex should add to your profile.
```

For Design Agent handoffs, include:

- Target screen/route and user workflow.
- Existing widgets/theme primitives relevant to the screen.
- Device sizes to consider, especially narrow mobile.
- Required states: loading, empty, error, success, dark mode, English/French.
- Screenshot/render status if available.

## Memory Update Rules

Add durable notes only when they will help future work. Good memory examples:

- The user rejects or prefers a clear design pattern.
- A test command, setup step, or failure mode repeats.
- A shared widget or service has a project-specific convention.
- A screen has business rules that are easy to forget.

Do not store one-off task details unless they represent a reusable rule.
