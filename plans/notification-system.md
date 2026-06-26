# Bottom-Left Notification System

## Summary
Add a reusable HUD notification feed beside the left dock rail. The feed listens to the existing `EventBus.notification_requested(message, type)` signal, so research completion and future combat notifications use the same UI path.

## Implementation
- Attach a new notification feed script to `ToastContainer`.
- Reposition `ToastContainer` to the lower-left HUD area beside the dock rail.
- Render notifications as non-blocking themed cards with a short fade/slide in and timed fade out.
- Cap visible notification cards to four.
- Emit a research notification when an entry completes.

## Verification
- Run the HUD manager headless test.
- Run the map debug scene headless startup.
- Confirm research completion routes through the notification feed.
