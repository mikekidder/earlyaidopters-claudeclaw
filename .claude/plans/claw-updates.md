# obsidian-prime-1 branch changes

## fix: skip redundant system prompt on resumed sessions
The full CLAUDE.md (~9k chars) was prepended to every user message, even on resumed sessions where the model already has it in context. Over a 27-turn conversation this wastes ~243k characters of redundant context. Fixed by checking for an existing session ID before injecting - first turn gets the prompt, subsequent turns skip it. Applied to both Telegram and dashboard message paths.

## feat: stream progressive text updates to Telegram
Users now see output building in real time instead of waiting for the full response. Throttled at 1.5s intervals with cursor indicator. Placeholder message is deleted before sending the final formatted response.

## feat: PM2 ecosystem config for Windows
Added `ecosystem.config.cjs` as the Windows equivalent of macOS launchd plist files. Auto-restart, log routing to `store/`, and scaffolding for multi-agent processes.

## fix: guard memory ingestion on Gemini API key
Early return in `ingestConversationTurn()` when `GOOGLE_API_KEY` is not configured, preventing unnecessary Gemini calls.
