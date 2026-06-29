# In-Game Chat Panel

## Summary
Add a real multiplayer chat MVP: an always-visible Godot HUD chat panel in the bottom-right, positioned to the right of the bottom selection panel when one is visible, with messages broadcast through Colyseus.

## Key Changes
- Add a `ChatPanel` Godot scene/script using `res://assets/themes/hud_dark.tres`.
- Layout: scrollable message history above, bottom input row with `TextEdit` and an icon-only send button using `res://assets/icons/arrow-right-to-bracket-solid-full.svg`.
- Message rendering uses `RichTextLabel` entries so time, email, and body have separate color/font styling.
- Input sends on button press and `Enter`; `Shift+Enter` inserts a newline. Empty/whitespace-only messages are ignored.
- Integrate chat into `GameHUD` as a persistent HUD child, not a `HUDManager` modal panel.
- Keep it always visible at the bottom-right and shift visible bottom selection panels left as needed so chat sits to their right.
- Add `AuthManager.user_email`, set from successful email login input, and clear it on logout.
- Client command: `SEND_CHAT`, payload `{ message: string }`.
- Server event: `CHAT_MESSAGE`, data `{ time: string, user_id: string, email: string, message: string }`.
- `ChatPanel` submits through `CommandQueue`; no direct `NetManager` calls.
- `SessionManager` routes `CHAT_MESSAGE` into `EventBus.chat_message_received`.
- Server trims messages, rejects empty messages, caps to 500 characters, and broadcasts sanitized plain text with server timestamp.

## Public Interfaces
- `AuthManager.user_email: String`
- `EventBus.chat_message_received(time: String, email: String, message: String)`
- Colyseus client command: `SEND_CHAT`
- Colyseus server event: `CHAT_MESSAGE`

## Test Plan
- Add/extend Godot HUD test coverage to instantiate `game_hud.tscn`, confirm `ChatPanel` exists, uses the HUD theme, has scroll history, input, and icon send button.
- Add a focused GDScript test for `ChatPanel` formatting and blank-message rejection.
- Add a Colyseus test with two clients: client A sends `SEND_CHAT`, both clients receive one `CHAT_MESSAGE` with expected email/message/time fields.
- Run available verification:
  - `npm test` in `game-server`
  - `npm run build` in `game-server`
  - Godot headless scene tests for HUD/chat where the Godot binary is available.

## Assumptions
- Root `package.json` is absent in the current repo checkout, so verification uses workspace-local commands where available.
- Chat is session-ephemeral and not saved to Supabase.
- Email in JWT is acceptable for this temporary email-auth phase; Steam display naming can replace it later.
