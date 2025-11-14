## Gemini Chat Testing Harness

Use the local harness to iterate on Gemini responses without redeploying:

1. Ensure `GEMINI_API_KEY` is exported in your shell (same key used in Netlify).
2. From the project root run `node scripts/test_chat.js "Your question here" --category "current students"` to exercise a single prompt.
3. To run the predefined suite, execute `npm run test:chat`. Edit `scripts/test-prompts.json` to tailor the scenarios (each item accepts `message`, optional `category`, and `history`).
4. The script invokes the Netlify `chat` function directly, so it uses your local knowledge files and logs the reply plus source metadata. Watch the console output for latency and any error payloads.

This approach keeps model changes local: tweak `netlify/functions/chat.js`, rerun the harness, and only push/deploy once you like the responses.
