#!/usr/bin/env node
import readline from "node:readline";
import chalk from "chalk";
import {
  chat,
  resolveModel,
  ModelMissingError,
  OllamaUnreachableError,
  type ChatMessage,
} from "./ollama.ts";
import {
  personas,
  findPersona,
  isCodeRequest,
  openingMessages,
  withReminder,
  type Persona,
} from "./persona.ts";
import {
  COLORS,
  DELAYS,
  MARGIN,
  SpiritWriter,
  decode,
  dim,
  faint,
  flicker,
  sleep,
  thinking,
  tombstone,
  typeLine,
} from "./ui.ts";

/** How many past exchanges the spirit remembers before older ones fade. */
const MAX_HISTORY_MESSAGES = 24;
const LEAVE_COMMANDS = new Set(["/leave", "/exit", "/quit", "/bye"]);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Lines are queued so nothing is lost if several arrive at once (a paste, or piped input).
const pendingLines: string[] = [];
let lineWaiter: ((line: string | null) => void) | null = null;
let inputClosed = false;
// Typed input gets its own color: open it at the end of the prompt, close it when the line is done.
const [USER_COLOR_OPEN, USER_COLOR_CLOSE] = COLORS.user("\0").split("\0");

rl.on("line", (line) => {
  if (process.stdout.isTTY) process.stdout.write(USER_COLOR_CLOSE);
  if (lineWaiter) {
    lineWaiter(line);
    lineWaiter = null;
  } else {
    pendingLines.push(line);
  }
});
rl.on("close", () => {
  inputClosed = true;
  lineWaiter?.(null);
});

/** Show a prompt and wait for the next line. Resolves null once input has closed. */
function ask(prompt: string): Promise<string | null> {
  if (pendingLines.length > 0) {
    const line = pendingLines.shift()!;
    if (!process.stdin.isTTY) console.log(prompt + line);
    return Promise.resolve(line);
  }
  if (inputClosed) return Promise.resolve(null);
  rl.setPrompt(process.stdout.isTTY ? prompt + USER_COLOR_OPEN : prompt);
  rl.prompt();
  return new Promise((resolve) => (lineWaiter = resolve));
}

let generating: AbortController | null = null;
let closing = false;

function fail(message: string): never {
  console.error("\n" + chalk.red("✝ ") + message + "\n");
  process.exit(1);
}

async function ritualIntro() {
  console.log();
  await tombstone();
  console.log();
  await flicker(`${MARGIN}🕯   S É A N C E   🕯`, COLORS.title);
  await typeLine(`${MARGIN}a ritual for the languages the living forgot`, faint);
  console.log();
}

async function chooseSpirit(): Promise<Persona> {
  const fromArgs = process.argv[2];
  if (fromArgs) {
    const p = findPersona(fromArgs);
    if (!p) fail(`No spirit named "${fromArgs}". Known spirits: ${personas.map((p) => p.id).join(", ")}`);
    return p;
  }
  if (personas.length === 1) {
    await typeLine(`${MARGIN}Only one spirit answers tonight.`, dim);
    return personas[0];
  }

  await typeLine(`${MARGIN}Which spirit do you wish to summon?`, chalk.white);
  console.log();
  personas.forEach((p, i) => {
    console.log(`${MARGIN}  ${dim(`${i + 1}.`)} ${spiritVoice(p).voice(p.name.padEnd(8))} ${faint(p.epitaph)}`);
  });
  console.log();
  const answer = ((await ask(`${MARGIN}${dim(`summon › [1] `)}`)) ?? "").trim();
  const picked = answer === "" ? personas[0] : findPersona(answer) ?? personas[Number(answer) - 1];
  if (!picked) {
    await typeLine(`${MARGIN}No such spirit stirs. The first one comes instead.`, faint);
    return personas[0];
  }
  return picked;
}

async function summon(persona: Persona) {
  console.log();
  for (const line of persona.summoning) {
    await typeLine(`${MARGIN}${line}`, faint);
    await sleep(DELAYS.summonLinePause);
  }
  console.log();
  await decode(persona.manifestation, spiritVoice(persona).voice);
  console.log(faint(`${MARGIN}type /leave to end the séance`));
  console.log();
}

function spiritVoice(persona: Persona) {
  if (!persona.color) return { voice: COLORS.spirit, code: COLORS.code };
  const voice = chalk.hex(persona.color);
  return { voice, code: voice.dim };
}

async function speakStatic(persona: Persona, text: string) {
  rl.pause();
  const { voice, code } = spiritVoice(persona);
  const writer = new SpiritWriter(voice, code);
  writer.write(text);
  await writer.end();
}

async function farewell(persona: Persona): Promise<never> {
  closing = true;
  console.log();
  const line = persona.farewells[Math.floor(Math.random() * persona.farewells.length)];
  await speakStatic(persona, line);
  console.log();
  await flicker(`${MARGIN}🕯  the candles go out.`, faint);
  console.log();
  rl.close();
  process.exit(0);
}

function withOpening(opening: ChatMessage[], history: ChatMessage[]): ChatMessage[] {
  // The opening always stays so the spirit never forgets its own voice; old turns fade.
  return [...opening, ...history.slice(-MAX_HISTORY_MESSAGES)];
}

async function main() {
  await ritualIntro();

  let model: string;
  try {
    model = await resolveModel();
  } catch (err) {
    if (err instanceof OllamaUnreachableError || err instanceof ModelMissingError) fail(err.message);
    throw err;
  }

  const persona = await chooseSpirit();
  const opening = openingMessages(persona);
  const history: ChatMessage[] = [];

  rl.on("SIGINT", () => {
    if (generating) {
      generating.abort();
      return;
    }
    if (!closing) void farewell(persona);
  });

  await summon(persona);
  await speakStatic(persona, persona.arrival);

  const { voice, code } = spiritVoice(persona);

  for (;;) {
    console.log();
    const line = await ask(`${MARGIN}${COLORS.prompt("you ›")} `);
    if (line === null) return farewell(persona); // stdin closed (Ctrl+D)
    const input = line.trim();
    if (!input) continue;
    if (LEAVE_COMMANDS.has(input.toLowerCase())) return farewell(persona);

    history.push({ role: "user", content: input });
    rl.pause(); // keystrokes typed while the spirit speaks wait for the next prompt
    console.log();

    const stopCandle = thinking();
    let candleLit = true;
    const writer = new SpiritWriter(voice, code);
    generating = new AbortController();

    try {
      const reply = await chat(
        model,
        withReminder(persona, withOpening(opening, history)),
        (isCodeRequest(input) && persona.codeOptions) || persona.options || {},
        (token) => {
          if (candleLit) {
            stopCandle();
            candleLit = false;
          }
          writer.write(token);
        },
        generating.signal,
      );
      if (candleLit) stopCandle();
      await writer.end();
      history.push({ role: "assistant", content: reply.trim() || "…" });
    } catch (err) {
      if (candleLit) stopCandle();
      await writer.end();
      history.pop(); // the question was never answered
      if ((err as Error).name === "AbortError") {
        console.log(faint(`${MARGIN}(the voice breaks off)`));
        continue;
      }
      if (err instanceof OllamaUnreachableError) {
        fail(`The connection to the other side was lost.\n${err.message}`);
      }
      fail((err as Error).message);
    } finally {
      generating = null;
    }
  }
}

main().catch((err) => fail((err as Error).stack ?? String(err)));
