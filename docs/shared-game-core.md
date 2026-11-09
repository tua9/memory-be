# Shared game core

The registry in `src/config/games.ts` defines the supported games and their rules. The engine registry in `src/games/index.ts` supplies each game's item generation, answer validation, comparison and presentation. Lifecycle, ownership, deadline checks, persistence, history, account EXP, records and streaks use the existing shared services.

## Adding a game

1. Add its config to `GAME_CONFIGS`: level counts, allowed times, custom limits, passing requirement and unlock rule.
2. Implement a `GameEngine` under `src/games/` and register it in `GAME_ENGINES`.
3. Use the default distinct-option answer parser for selection games. Supply `parseAnswers` for repeated digits or free-text answers and `matches` for custom comparison.
4. For identification games, supply `toRecallView` without labels/solutions and `answerView` to render the submitted text in result review.
5. Add optional per-level recall durations and required scores to the config. `wrongAnswerPenalty` and `requiredScore` are copied into the session rules at creation so config changes do not alter saved scoring rules.
6. Add UI metadata to the frontend registry and implement the game-specific board. Reuse the session API, shared timer and common controls. Do not calculate account progress or unlock levels on the client.
7. Test generation, invalid answers, blanks, grading, unlock rules, ownership, expired phases and repeated/concurrent submissions.

## API and data flow

- `GET /api/games` returns all four games, level-specific rules and the current player's progress.
- `POST /api/game-sessions` accepts `gameName`, `mode`, `gameLevel`, `itemCount`, `memorizeSec` and (only where configured in custom mode) `recallSec`.
- `POST /api/game-sessions/:id/recall` returns recall options and a server deadline. FaceName options contain portraits and person IDs, without names.
- `POST /api/game-sessions/:id/submit` accepts an array of answers in the original item order. FaceName answers are strings or null; Numbers allows repeated digits. Results can include `score` and `maxScore` independently of accuracy.
- Responses include `serverNow` for client clock adjustment and disable caching for session actions.
- Account sessions, game progress and user rewards settle in one MongoDB transaction. A repeated submission returns the existing result.
- Guest sessions keep the existing expiring guest progress and receive no account rewards.

## Numbers compatibility adapter

Numbers keeps its existing `/numbers` API and `number_sessions` documents for autosave, revisions, preparation/deadlines and its separate daily challenge. New sessions opt into shared progress with `sharedProgress: true`.

When a source round completes, `numberSettlement.service.ts` copies its immutable server-side result input into a shared session with the **same `_id`**, then uses the normal account settlement transaction. The source is marked `progressRecordedAt` only after shared settlement succeeds. This makes the shared session ID an idempotency key and prevents repeated rewards on submit/read retries.

The Numbers sweep also retries completed opted-in sources missing this marker. A failure after the source completes does not discard answers or results; retrying the request or the background worker resumes recording. The source completion and shared settlement are deliberately separate transactions; there can be a short delay before a completed Numbers round appears in the common dashboard.

Numbers daily attempts retain their own one-attempt-per-day index. Their shared history uses mode `daily`, but does not set the global `challengeDate`, so they do not consume the separate global daily challenge. Its rotation remains card/image until deliberately changed in `config/dailyChallenge.ts`.

## Existing data and rollout

- Deploy backend before the updated frontend. MongoDB must support transactions, as already required by account card/image rounds. Create the new Numbers reconciliation index before enabling heavy traffic.
- Existing API routes and collections remain available. No destructive migration or production write is performed by this change.
- Existing Numbers level unlocks are merged with shared progress when resolving playable levels and building the catalog. Existing Numbers history stays available through `/numbers/sessions`; old sessions are not retroactively granted EXP or imported into shared history automatically.
- The legacy FaceName `/game/levels` and `/game/rounds` routes remain compatible. Updated frontend clients use `/games` and `/game-sessions`, with progress stored per account or guest identity.
- Old browser-only FaceName stats are left in local storage. They are not trusted as account unlocks or rewards. Server progress starts with rounds played through the shared API; a verified data import would be a separate migration.
- `npm test` includes the model-double service tests. Real MongoDB verification is in `test/sharedGame.integration.test.ts` and requires a dedicated replica-set test database configured as `MONGODB_TEST_CONNECTION_STRING`; the existing safety guard rejects the application database.

## Frontend boundaries

`features/shared-game/registry.ts` owns names, routes, chart colors and units. Rules and current progress come from the backend catalog. Cards, Images, Numbers and FaceName use the shared phase timer. Each game keeps its own rendering and input model. Numbers keeps its serialized save queue; FaceName uses a small API adapter to preserve its existing board components while using the shared backend lifecycle.
