import type { ChatMessage, ChatOptions } from "./ollama.ts";
import { cobol } from "../personas/cobol.ts";

export interface Persona {
  /** Short id used on the command line, e.g. `npm start -- cobol`. */
  id: string;
  /** Display name shown above each reply. */
  name: string;
  /** One-line epitaph shown in the summoning menu. */
  epitaph: string;
  /** Hex color override for the spirit's voice. Defaults to the CRT phosphor in ui.ts. */
  color?: string;
  /** Lines printed while the spirit is being summoned. */
  summoning: string[];
  /** Short line the summoning noise decodes into. Keep it under ~60 characters. */
  manifestation: string;
  /** The spirit's first words. Also seeded into history so the model hears its own voice. */
  arrival: string;
  /** One of these is spoken when the user leaves. */
  farewells: string[];
  /** The character. This is the product. */
  systemPrompt: string;
  /**
   * Few-shot turns from "earlier séances", sent before the real conversation.
   * Small models copy example turns far more faithfully than written rules.
   */
  examples: ChatMessage[];
  /** Appended to the newest caller message only, never shown or stored. Keeps small models on track. */
  reminder?: string;
  /** Used instead of `reminder` when the caller asks whether the spirit is an AI. */
  doubtReminder?: string;
  /** Used instead of `reminder` when the caller seems to be asking for code. */
  codeReminder?: string;
  /** Overrides `options` when the caller asks for code (e.g. a lower temperature, so the code is correct). */
  codeOptions?: ChatOptions;
  options?: ChatOptions;
}

export const personas: Persona[] = [cobol];

export function findPersona(id: string): Persona | undefined {
  const needle = id.trim().toLowerCase();
  return personas.find((p) => p.id === needle || p.name.toLowerCase() === needle);
}

/** Marks the boundary between the example séances and the real one. */
const NEW_CALLER = "[Years pass. The candles are lit again. A new caller sits down at the terminal.]";

/**
 * Everything the model sees before the caller's first word: the character,
 * the earlier séances, and the spirit's own arrival line.
 */
export function openingMessages(persona: Persona): ChatMessage[] {
  return [
    { role: "system", content: persona.systemPrompt },
    ...persona.examples,
    { role: "user", content: NEW_CALLER },
    { role: "assistant", content: persona.arrival },
  ];
}

const DOUBT = /\b(ai|a\.i\.|bot|chatbot|llm|language model|model|gemma|ollama|real|fake|artificial|program pretending)\b/i;
const CODE_REQUEST = /\b(write|show|give|make|code|program|example|fix|implement)\b[\s\S]*\b(cobol|code|program|paragraph|copybook)\b/i;

export const isCodeRequest = (text: string) => CODE_REQUEST.test(text);

/** Attach the persona's reminder to the newest caller message, without touching stored history. */
export function withReminder(persona: Persona, messages: ChatMessage[]): ChatMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "user") return messages;
  const reminder =
    (isCodeRequest(last.content) && persona.codeReminder) ||
    (DOUBT.test(last.content) && persona.doubtReminder) ||
    persona.reminder;
  if (!reminder) return messages;
  return [...messages.slice(0, -1), { role: "user", content: `${last.content}\n\n${reminder}` }];
}
