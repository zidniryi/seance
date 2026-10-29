import chalk, { type ChalkInstance } from "chalk";

// ─── Tuning ────────────────────────────────────────────────────────────────
// Everything you might want to adjust after watching a recording lives here.
// All delays are in milliseconds and are multiplied by SEANCE_PACE
// (default 1; 0 turns every effect off, 2 is twice as slow).

export const DELAYS = {
  // spirit replies (typewriter)
  replyChar: 14, // per character of prose
  sentencePause: 110, // extra pause after . ? ! …
  clausePause: 45, // extra pause after , ; : —
  paragraphPause: 140, // on a blank line / newline
  codeChar: 3, // per character inside ```code```
  codeLine: 35, // after each line of code

  // intro ritual
  tombstoneLine: 85, // between tombstone lines
  tombstoneFade: 55, // per fade step within a line
  titleFlickerStep: 70, // per flicker frame of the title
  ritualChar: 10, // per character of dim ritual text
  summonLinePause: 220, // after each "Loading the deck…" line

  // summoning decode effect
  decodeDuration: 1500, // total time from noise to the resolved line
  decodeFrame: 40, // redraw interval

  // thinking indicator
  thinkingFrame: 180, // flicker interval of the "..."
};

/** Old CRT phosphors. Swap THEME below, or run with SEANCE_THEME=amber. */
export const PHOSPHORS = {
  green: { spirit: "#3EDC6E", code: "#2A9E4E", glitch: "#1C6B35" },
  amber: { spirit: "#E0A030", code: "#A87420", glitch: "#6B4A14" },
} as const;

const THEME = PHOSPHORS[process.env.SEANCE_THEME === "amber" ? "amber" : "green"];

export const COLORS = {
  spirit: chalk.hex(THEME.spirit), // the spirit's voice
  code: chalk.hex(THEME.code), // COBOL the spirit writes
  glitch: chalk.hex(THEME.glitch), // undecoded noise
  user: chalk.hex("#D8DEE9"), // what you type
  prompt: chalk.gray, // the "you ›" label
  title: chalk.hex("#E8D9B0").bold,
  tombstone: chalk.hex("#8A8F98"),
  dim: chalk.gray,
  faint: chalk.dim.gray,
};

/** Characters the decode effect cycles through before settling. */
const GLITCH_GLYPHS = "▓▒░█#%&@$*+=<>/\\|01ΣΞ¤§";

const TOMBSTONE = [
  "     .-------------.",
  "    /               \\",
  "   |    R . I . P    |",
  "   |                 |",
  "   |  HERE LIE THE   |",
  "   |  LANGUAGES WE   |",
  "   |     FORGOT      |",
  "   |                 |",
  " ~~|~~~~~~~~~~~~~~~~~|~~",
];

// ───────────────────────────────────────────────────────────────────────────

const out = process.stdout;
const isTTY = Boolean(out.isTTY);
const pace = isTTY ? Number(process.env.SEANCE_PACE ?? 1) : 0;
const animated = pace > 0;

export const sleep = (ms: number) =>
  animated ? new Promise<void>((resolve) => setTimeout(resolve, ms * pace)) : Promise.resolve();

export const MARGIN = "   ";
const width = () => Math.min((out.columns || 80) - 2, 88);
const clearLine = "\r\x1b[2K";

export const dim = COLORS.dim;
export const faint = COLORS.faint;

/** The tombstone, fading in line by line. */
export async function tombstone() {
  for (const line of TOMBSTONE) {
    if (animated) {
      for (const shade of [chalk.hex("#2A2D32"), chalk.hex("#50545B")]) {
        out.write(clearLine + MARGIN + shade(line));
        await sleep(DELAYS.tombstoneFade);
      }
      out.write(clearLine);
    }
    out.write(MARGIN + COLORS.tombstone(line) + "\n");
    await sleep(DELAYS.tombstoneLine);
  }
}

/** Fade a line in from dark to bright, with a short candle-like flicker. */
export async function flicker(text: string, color: ChalkInstance = chalk.white) {
  if (!animated) {
    out.write(color(text) + "\n");
    return;
  }
  for (const frame of [faint, dim, faint, dim, color.dim, color]) {
    out.write(clearLine + frame(text));
    await sleep(DELAYS.titleFlickerStep * (0.7 + Math.random() * 0.6));
  }
  out.write("\n");
}

/** Type a line out character by character. */
export async function typeLine(text: string, color: ChalkInstance = dim, delay = DELAYS.ritualChar) {
  if (!animated) {
    out.write(color(text) + "\n");
    return;
  }
  for (const ch of text) {
    out.write(color(ch));
    await sleep(delay);
  }
  out.write("\n");
}

/**
 * Random glyphs that resolve, character by character, into `text`,
 * like a signal being decoded. Keep `text` to one line.
 */
export async function decode(text: string, color: ChalkInstance = COLORS.spirit) {
  if (!animated) {
    out.write(MARGIN + color(text) + "\n");
    return;
  }
  const chars = [...text];
  // Each character settles at its own moment, roughly left to right.
  const settleAt = chars.map((_, i) => 0.25 + 0.6 * (i / chars.length) + Math.random() * 0.15);
  const frames = Math.max(1, Math.round(DELAYS.decodeDuration / DELAYS.decodeFrame));

  for (let f = 0; f <= frames; f++) {
    const progress = f / frames;
    let line = "";
    chars.forEach((ch, i) => {
      if (ch === " " || progress >= settleAt[i]) line += color(ch);
      else line += COLORS.glitch(GLITCH_GLYPHS[Math.floor(Math.random() * GLITCH_GLYPHS.length)]);
    });
    out.write(clearLine + MARGIN + line);
    await sleep(DELAYS.decodeFrame);
  }
  out.write(clearLine + MARGIN + color(text) + "\n");
}

/** A flickering "..." while the spirit gathers itself. Returns a stop function. */
export function thinking(): () => void {
  if (!isTTY) return () => {};
  const dots = [".", "..", "...", "...", " ..", "  .", ""];
  const shades = [faint, dim, COLORS.glitch];
  let i = 0;
  const draw = () => {
    const shade = shades[Math.floor(Math.random() * shades.length)];
    out.write(clearLine + MARGIN + shade(dots[i % dots.length]));
    i++;
  };
  draw();
  const timer = setInterval(draw, DELAYS.thinkingFrame);
  return () => {
    clearInterval(timer);
    out.write(clearLine);
  };
}

/**
 * Renders a streamed reply as if it were arriving from somewhere far away:
 * word-wrapped, indented, typed out, with ```fenced``` code kept verbatim.
 */
export class SpiritWriter {
  private pending = "";
  private ended = false;
  private col = 0;
  private atLineStart = true;
  private inCode = false;
  private bold = false;
  private italic = false;
  private spaceOwed = false;
  private wake: (() => void) | null = null;
  private done: Promise<void>;

  constructor(private voice: ChalkInstance = COLORS.spirit, private codeVoice: ChalkInstance = COLORS.code) {
    this.done = this.pump();
  }

  write(text: string) {
    this.pending += text;
    this.wake?.();
  }

  /** Signal the end of the stream and wait for everything to be printed. */
  async end() {
    this.ended = true;
    this.wake?.();
    await this.done;
  }

  private waitForMore() {
    return new Promise<void>((resolve) => (this.wake = resolve));
  }

  private take(n: number) {
    const s = this.pending.slice(0, n);
    this.pending = this.pending.slice(n);
    return s;
  }

  private newline() {
    out.write("\n");
    this.col = 0;
    this.atLineStart = true;
    this.spaceOwed = false;
  }

  private async pump() {
    for (;;) {
      if (this.pending.length === 0) {
        if (this.ended) break;
        await this.waitForMore();
        continue;
      }

      if (this.atLineStart) {
        // Need a few chars to know whether this line is a code fence.
        const nl = this.pending.indexOf("\n");
        if (this.pending.length < 3 && nl === -1 && !this.ended) {
          await this.waitForMore();
          continue;
        }
        if (/^[ \t]*```/.test(this.pending)) {
          if (nl === -1 && !this.ended) {
            await this.waitForMore();
            continue;
          }
          const line = this.take(nl === -1 ? this.pending.length : nl + 1).trim();
          this.inCode = !this.inCode;
          out.write(MARGIN + faint(line) + "\n");
          await sleep(DELAYS.codeLine);
          continue;
        }
        if (this.pending[0] === "\n") {
          this.take(1);
          this.newline();
          await sleep(DELAYS.paragraphPause);
          continue;
        }
        this.atLineStart = false;
        out.write(MARGIN);
        this.col = MARGIN.length;
        if (!this.inCode) this.pending = this.pending.replace(/^[ \t]+/, "");
        continue;
      }

      if (this.inCode) {
        const ch = this.take(1);
        if (ch === "\n") {
          this.newline();
          await sleep(DELAYS.codeLine);
        } else {
          out.write(this.codeVoice(ch));
          await sleep(DELAYS.codeChar);
        }
        continue;
      }

      // Prose: word by word, so lines wrap on word boundaries.
      const head = this.pending[0];
      if (head === "\n") {
        this.take(1);
        this.newline();
        await sleep(DELAYS.paragraphPause);
        continue;
      }
      if (head === " " || head === "\t") {
        this.take(1);
        this.spaceOwed = this.col > MARGIN.length;
        continue;
      }
      const match = /^\S+/.exec(this.pending)!;
      if (match[0].length === this.pending.length && !this.ended) {
        await this.waitForMore(); // the word may not be finished yet
        continue;
      }
      const word = this.take(match[0].length);
      await this.printWord(word);
    }
    if (!this.atLineStart) this.newline();
    this.bold = false;
    this.italic = false;
  }

  private async printWord(word: string) {
    const visible = word.length > 1 ? word.replace(/\*/g, "") : word;
    const needed = visible.length + (this.spaceOwed ? 1 : 0);
    if (this.col + needed > width() && this.col > MARGIN.length) {
      out.write("\n" + MARGIN);
      this.col = MARGIN.length;
    } else if (this.spaceOwed) {
      out.write(" ");
      this.col++;
    }
    this.spaceOwed = false;

    for (let i = 0; i < word.length; i++) {
      if (word.startsWith("**", i)) {
        this.bold = !this.bold;
        i++;
        continue;
      }
      // *emphasis*, but leave a lone "*" (multiplication) alone
      if (word[i] === "*" && word.length > 1) {
        this.italic = !this.italic;
        continue;
      }
      const ch = word[i];
      let style = this.voice;
      if (this.bold) style = style.bold;
      if (this.italic) style = style.italic;
      out.write(style(ch));
      this.col++;
      await sleep(DELAYS.replyChar);
    }
    if (/[.?!…]$/.test(visible)) await sleep(DELAYS.sentencePause);
    else if (/[,;:—]$/.test(visible)) await sleep(DELAYS.clausePause);
  }
}
