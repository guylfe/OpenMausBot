---
version: alpha
name: OpenMausBot
description: A local-first chat app for running a team of AI agents.
omitted:
  - section: colors
    reason: Runtime palette and skin overrides are owned by src/styles.css.
  - section: typography
    reason: Runtime font stacks are owned by src/styles.css.
  - section: rounded
    reason: Existing shared components own their geometry.
  - section: spacing
    reason: Existing layout components own their spacing.
  - section: components
    reason: Shared React components are the maintained implementation.
---

# OpenMausBot design context

## Overview

The interface is a working team chat: a familiar transcript, a quiet bot list,
and explicit cards when a person must act. This record describes existing
implementation; it does not generate tokens or introduce a new visual system.
The runtime source of truth is [src/styles.css](src/styles.css), including each
skin's semantic colors and fonts. Shared components own geometry and behavior.

## Colors

Use semantic panel, raised, ink, warning, danger and focus tokens. Skins may
change their values while retaining their meaning. Pending-input badges use
warning; connection and submission failures use danger with readable text.

## Typography

Use the runtime sans and mono font stacks, including their system fallbacks.
Task titles allow bidirectional text and wrap. Copy uses the current locale;
new English strings use the existing locale fallback policy.

## Layout

Keep the existing chat width and scroll owner. Input cards use the transcript
width and wrap on narrow screens; they do not introduce a second chat pane.

## Elevation & Depth

Reuse ELEVATED_CARD and the existing question, approval and credential surfaces.
Do not add decorative elevation to request provenance or sidebar counts.

## Shapes

Retain each existing card's radius and control shape. The bot-wide count uses
the existing compact pill vocabulary.

## Components

QuestionCard, PendingApproval, SecretRequestCard, SignInRequestCard and
ConnectorCard own their respective actions, validation and request semantics.
The main-chat projection composes these owners without another answer flow.
Loading, failure, disconnected and resolved states must remain distinguishable.
Native buttons and inputs retain keyboard operation and visible focus. Icons
use the existing Lucide family. Motion follows the application's stylesheet.

## Do's and Don'ts

- Keep the source task visible beside every projected request.
- Use text as well as color to communicate errors and pending work.
- Preserve the original request and permission policy across every view.
- Avoid adding a dashboard or modal when an existing chat card can do the job.
