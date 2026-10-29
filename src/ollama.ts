// Thin client for the local Ollama HTTP API. The only host this app ever talks to.

export const OLLAMA_URL = "http://localhost:11434";

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  top_p?: number;
  repeat_penalty?: number;
  num_ctx?: number;
  num_predict?: number;
}

export class OllamaUnreachableError extends Error {
  constructor() {
    super(
      `Could not reach Ollama at ${OLLAMA_URL}.\n` +
        `Start it with \`ollama serve\` (or open the Ollama app), then try again.`,
    );
  }
}

export class ModelMissingError extends Error {}

interface TagsResponse {
  models: { name: string; size: number }[];
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}${path}`, init);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new OllamaUnreachableError();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 404 && body.includes("not found")) {
      throw new ModelMissingError(body);
    }
    throw new Error(`Ollama returned ${res.status}: ${body}`);
  }
  return res;
}

export async function listModels(): Promise<TagsResponse["models"]> {
  const res = await request("/api/tags");
  const data = (await res.json()) as TagsResponse;
  return data.models ?? [];
}

/**
 * Pick the model to use. SEANCE_MODEL wins if set; otherwise the largest
 * chat-capable Gemma model that is already pulled.
 */
export async function resolveModel(): Promise<string> {
  const models = await listModels();
  const wanted = process.env.SEANCE_MODEL?.trim();

  if (wanted) {
    const found = models.some(
      (m) => m.name === wanted || m.name === `${wanted}:latest`,
    );
    if (!found) {
      throw new ModelMissingError(
        `Model "${wanted}" (from SEANCE_MODEL) is not pulled.\n` +
          `Run \`ollama pull ${wanted}\`, or unset SEANCE_MODEL to auto-pick a Gemma model.`,
      );
    }
    return wanted;
  }

  const gemmas = models
    .filter((m) => /gemma/i.test(m.name) && !/embed/i.test(m.name))
    .sort((a, b) => b.size - a.size);

  if (gemmas.length === 0) {
    throw new ModelMissingError(
      `No Gemma chat model found in Ollama.\n` +
        `Pull one first, e.g. \`ollama pull gemma3:4b\` (recommended) or \`ollama pull gemma3:1b\` (lighter).\n` +
        `Or point SEANCE_MODEL at any model you already have.`,
    );
  }
  return gemmas[0].name;
}

/**
 * Stream a chat completion. Calls onToken for each chunk of text and
 * resolves with the full reply.
 */
export async function chat(
  model: string,
  messages: ChatMessage[],
  options: ChatOptions,
  onToken: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, options, stream: true }),
    signal,
  });
  if (!res.body) throw new Error("Ollama returned an empty response body.");

  const decoder = new TextDecoder();
  let buffered = "";
  let full = "";

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line) as {
      message?: { content?: string };
      error?: string;
    };
    if (chunk.error) throw new Error(`Ollama: ${chunk.error}`);
    const text = chunk.message?.content ?? "";
    if (text) {
      full += text;
      onToken(text);
    }
  };

  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffered += decoder.decode(part, { stream: true });
    let newline: number;
    while ((newline = buffered.indexOf("\n")) !== -1) {
      handleLine(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
    }
  }
  handleLine(buffered);
  return full;
}
