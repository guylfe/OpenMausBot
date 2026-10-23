---
version: alpha
colors:
  defaultInk: "#fcfcfc"
  defaultSecondaryInk: "#fcfcfc99"
  defaultInset: "#191919"
  defaultHairline: "#333333"
  primary: "#1084fe"
typography:
  body:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif'
omitted:
  - section: rounded
    reason: Existing Tailwind component classes own geometry.
  - section: spacing
    reason: Existing chat and settings layouts own spacing.
---

## Overview

OpenMausBot is a local chat workbench. New thread controls should feel like the
existing model and approval controls: compact, quiet, and explicit about what
will run. Connection status and the actor behind a reply carry meaning; they
are not decorative badges.

## Colors

`src/styles.css` is the canonical runtime token source. The frontmatter records
the default dark skin only. All skins override semantic tokens there. Components
use `ink`, `ink-secondary`, `inset`, `raised`, `hairline`, `accent`, and `danger`
utilities rather than copying these values. This feature changes no skin tokens.

## Typography

Inherit the current skin's sans font. Settings labels use the existing 12–13px
scale; exact conversation and delivery identifiers use the system monospace
stack and wrap instead of widening the chat. Reply text retains the normal chat
renderer and its locale-aware font fallbacks.

## Layout

Thread connection controls are an inline disclosure above the transcript. They
wrap at narrow widths, reserve a status line, and keep long result lists inside
a bounded scroll area. They do not create a second conversation window.

## Elevation & Depth

Use existing inset surfaces and hairline borders. Static connection information
has no new shadows or animation.

## Shapes

Reuse the existing field and rounded-lg action geometry. Keep touch controls
visible and keyboard focus explicit.

## Components

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select | `src/components/Select.tsx` | Existing application implementation | Native platform popup | Component and browser fixture |
| Confirmation | `src/components/ConfirmDialog.tsx` | Existing application implementation | Disconnect names its routing consequence | Browser fixture |
| Approval and questions | `ApprovalCard`, `QuestionCard` | Existing application implementation | Native requests, exact scoped verdicts | Server fixture and unit tests |
| Attachments | `AttachmentGallery`, server attachment store | Existing application implementation | Admitted inline images and supported files | Server and browser fixture |
| Feedback | Inline status and alert regions | Existing application implementation | Server-confirmed connection; uncertain delivery requires review | Component and server fixtures |
| Scrollbar | `src/styles.css` | Existing application implementation | Existing global baseline | Existing application contract |
| Locale | `src/lib/i18n.ts`, `src/locales/en.json` | Existing application implementation | Catalog keys; existing English fallback | `pnpm i18n:check` |

## Do's and Don'ts

Keep Codex provenance separate from its original response text. Say Connected or
Ready only after native resume and history reconciliation succeed. Keep failed
and disconnected bindings reserved until the user disconnects them. Do not add
normal bot instructions, model overrides, or silent replay to the native flow.
