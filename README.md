# Séance

A terminal séance with the ghost of COBOL.

Millions of banking, insurance, and government systems still run on COBOL, written by people who have mostly retired or died. Séance lets you sit down at your terminal, light a candle, and talk to that ghost directly. It answers in character: formal, a little wounded, proud of still being load-bearing, suspicious of JavaScript. It also knows its trade. Ask it for real COBOL and it will write you some.

It is a small Node.js wrapper around [Ollama](https://ollama.com) running a Gemma model on your own machine.

## Runs 100% locally

- No account, no API key, no cloud AI.
- No telemetry, no logging of anything you type. The conversation lives in memory and is gone when you leave.
- The only network call the app makes is to Ollama on `http://localhost:11434`. Once the model is pulled you can turn the wifi off.

## Setup

1. Install Ollama: <https://ollama.com/download>, then make sure it is running (`ollama serve`, or open the Ollama app).
2. Pull a Gemma model:

   ```sh
   ollama pull gemma3:4b     # recommended
   # or, on a smaller machine (stays in character, but its COBOL is often wrong):
   ollama pull gemma3:1b
   ```

3. Install and run:

   ```sh
   npm install
   npm start
   ```

Requires Node.js 18.17 or newer.

## Usage

Type as if you were at an old terminal. The spirit answers.

- `/leave` or `/exit` ends the séance.
- `Ctrl+C` while the spirit is speaking interrupts it. `Ctrl+C` at the prompt ends the séance.

### Configuration

| Variable       | Default                                 | What it does                                                              |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| `SEANCE_MODEL` | largest Gemma chat model you have pulled | Use a specific Ollama model, e.g. `SEANCE_MODEL=gemma3:4b npm start`.     |
| `SEANCE_PACE`  | `1`                                     | Multiplier for every animation delay. `0` turns the effects off, `2` is twice as slow. |
| `SEANCE_THEME` | `green`                                 | CRT phosphor for the spirit's voice: `green` or `amber`.                  |

All delays and colors are constants at the top of `src/ui.ts`.

Very small models (such as `gemma3:270m`) cannot hold the character. They tend to repeat themselves. Use `1b` or larger.

## Project layout

```
src/index.ts       terminal loop, ritual intro, farewell
src/ollama.ts      thin client for the local Ollama HTTP API
src/persona.ts     persona type and registry
src/ui.ts          pacing, flicker, word-wrapped streaming output
personas/cobol.ts  the COBOL spirit: system prompt, colors, intro and farewell lines
```

To add a spirit, create a new file in `personas/` that exports a `Persona`, then add it to the list in `src/persona.ts`.

## License

MIT. See [LICENSE](LICENSE).

## Credits

Written from scratch for Hacktoberfest 2026. Nothing is adapted from other projects. It runs on [Ollama](https://ollama.com) and Google's open-weight [Gemma](https://ai.google.dev/gemma) models, which are used under their own licenses and are not bundled with this repo.
