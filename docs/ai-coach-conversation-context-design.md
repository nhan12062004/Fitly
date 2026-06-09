# AI Coach Conversation Context Design

This document defines how AI Coach should present workout and meal-plan context, and how it should handle side questions such as recovery, self-care, and motivation.

## Goal

Make AI Coach feel like one coach in one thread, while still separating:

- plan editing requests
- health and recovery advice
- motivation and adherence support
- out-of-scope questions

The user should not need to switch screens or modes manually. The system should detect intent, answer in the right mode, and only mutate plan data when the request is clearly about the current plan.

## Current Product Shape

The current `AI Coach` page is a day-based chat experience:

- It loads today's workout and meal plan.
- It sends `selectedDayIndex` and `weekStartDate` with each chat request.
- It can already render actionable plan changes for:
  - `replace_today_workout`
  - `replace_today_meal`
- It already supports basic local fallback logic for:
  - meal questions
  - workout questions
  - injury-care style questions
  - simple high-protein meal suggestions

This design keeps that model and formalizes it.

## Core Principle

AI Coach should always answer inside one of these context layers:

1. `Plan context`
The user is asking about today's workout or meal plan.

2. `Coach advice context`
The user is asking for guidance related to training, nutrition, recovery, soreness, sleep, or self-care, but is not directly asking to change today's plan.

3. `Support context`
The user is asking for motivation, consistency help, or emotional support around adherence.

4. `Safety context`
The user is asking about pain, injury, dizziness, abnormal symptoms, or other questions that may require conservative guidance.

5. `Out-of-scope context`
The user is asking about topics that are unrelated to fitness, nutrition, recovery, or health behavior.

## Conversation Boundary

The main conversation unit should be `one user, one day, one thread`.

- Chat resets by day, not by login session.
- Within the same day, context persists across reload, logout, and login.
- On a new day, AI Coach opens a new thread with a fresh digest for that day.
- Older threads may remain in storage for audit, debugging, or future history UI, but are not the default active thread.

## Intent Model

The classifier should map each user message to one primary intent:

- `workout_plan`
- `meal_plan`
- `recovery`
- `injury_care`
- `motivation`
- `general_health`
- `out_of_scope`

The classifier may also store secondary tags such as:

- `today`
- `fat_loss`
- `muscle_gain`
- `fatigue`
- `pain`
- `protein`
- `sleep`
- `stress`

## Response Modes

Each intent should map to one response mode.

### 1. `plan_edit`

Used for `workout_plan` and `meal_plan` requests when the user clearly wants to change the active plan.

Examples:

- "Doi bua toi gon hon"
- "Buoi chan hom nay nhe hon"
- "Thay bai squat bang bai de hon"

Rules:

- Answer using today's actual plan context first.
- If a change is proposed, return `actionRequired = true`.
- Only return actionable payloads for explicit plan changes.
- Do not silently change database state inside the chat reply.

### 2. `coach_advice`

Used for `recovery` and `general_health`.

Examples:

- "Tap xong nen an gi"
- "Hom nay met, nen giam tai nhu nao"
- "Ngu 5 tieng co nen tap tiep khong"

Rules:

- Answer with practical guidance, not a plan mutation.
- Reference today's plan when useful.
- Offer an optional follow-up action such as:
  - "Neu ban muon, minh co the rut gon buoi tap hom nay"
- Do not set `actionRequired` unless the user confirms they want the change.

### 3. `support`

Used for `motivation`.

Examples:

- "Hom nay toi luoi tap qua"
- "Toi hay bo bua toi"
- "Khong co dong luc"

Rules:

- Acknowledge the state without sounding clinical or generic.
- Reduce the barrier to action.
- End with one concrete next step tied to today.
- Prefer behavior coaching over inspirational text.

Suggested response structure:

- reflect current state
- shrink the task
- suggest one immediate action
- optionally offer to shorten today's plan

### 4. `safety`

Used for `injury_care` and symptom-heavy messages.

Examples:

- "Co chan toi dau sau khi chay"
- "Khop goi sung nhe sau tap"
- "Tap xong choang vang"

Rules:

- Give conservative, low-risk advice only.
- Tell the user when to pause training.
- Tell the user when to seek medical care.
- Avoid diagnosis language unless strictly necessary and framed as uncertainty.
- Do not auto-edit today's plan unless the user explicitly asks for a safer alternative.

### 5. `redirect`

Used for `out_of_scope`.

Examples:

- "Giup toi viet email"
- "Hom nay vang co tang khong"

Rules:

- Reply briefly.
- State that AI Coach focuses on training, nutrition, and recovery.
- Offer to help with a related fitness question instead.

## Context Assembly

Before generating a reply, the system should assemble context in this order:

1. active day summary
2. today's workout items
3. today's meal items
4. recent same-day chat messages
5. user profile and goal summary
6. relevant safety signals

The model should prefer today's context by default. It should not drift into generic advice if relevant plan data exists.

## UI Behavior

The chat UI should present context differently by response mode.

### For `plan_edit`

- Show normal assistant bubble.
- Render proposal card below the bubble.
- Show `Apply` and `Reject` buttons.

### For `coach_advice`

- Show a normal assistant bubble only.
- No proposal card by default.
- Optional quick action chips may be added later:
  - `Rut gon buoi tap`
  - `Doi bua toi`
  - `Goi y phuc hoi`

### For `support`

- Show compact assistant bubble.
- Keep copy short and grounded.
- Offer one small next action linked to today's plan.

### For `safety`

- Show assistant bubble with caution tone.
- No plan mutation controls by default.
- Allow follow-up question paths such as:
  - "Tao buoi tap nhe hon"
  - "Bo bai tac dong cao"

## Decision Rules

Use these rules in order:

1. If the message asks to modify today's workout or meal plan, use `plan_edit`.
2. If the message mentions pain, swelling, dizziness, numbness, or injury terms, use `safety`.
3. If the message asks how to recover, sleep, stretch, eat after training, or reduce fatigue, use `coach_advice`.
4. If the message expresses avoidance, lack of motivation, or adherence struggle, use `support`.
5. Otherwise, if it is unrelated to AI Coach domain, use `redirect`.

## Data Contract

The backend chat response should support this shape:

```ts
type AIChatResponse = {
  reply: string;
  intent:
    | 'workout_plan'
    | 'meal_plan'
    | 'recovery'
    | 'injury_care'
    | 'motivation'
    | 'general_health'
    | 'out_of_scope';
  responseMode: 'plan_edit' | 'coach_advice' | 'support' | 'safety' | 'redirect';
  actionRequired: boolean;
  actionType: string | null;
  actionPayload: unknown;
  confidence: number;
  adjustmentId?: string | null;
};
```

## Safety Rules

- AI Coach is not a medical diagnosis tool.
- Pain and injury questions should always produce conservative guidance.
- Red-flag symptoms should recommend professional care.
- The system should never present unsafe certainty about injuries or illness.
- The system should never auto-apply plan reductions or removals without explicit user confirmation.

## Acceptance Criteria

- A meal or workout change request produces an actionable proposal tied to today's plan.
- A recovery question gives advice without mutating plan state.
- A motivation question gives behavior coaching and one immediate next step.
- A pain or injury question gives conservative guidance and escalation signs.
- Reloading or logging in again on the same day preserves the thread.
- A new day starts a new thread with a fresh daily digest.

