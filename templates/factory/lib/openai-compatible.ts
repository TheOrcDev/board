import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

// A tiny OpenAI-compatible chat/completions client, plus a mock server the dry-run uses when
// GRID_API_KEY is absent. The factory agent uses the same shape through createOpenAICompatible.

export const GRID_BASE_URL = "https://api.thegrid.ai/v1";
export const GRID_CONTEXT_WINDOW_TOKENS = 196_608;
export const DEFAULT_GRID_MODEL = "text-prime";
export const FALLBACK_GRID_MODEL = "agent-prime";

export const gridInstrument = (env: Record<string, string | undefined> = process.env): string =>
  env.GRID_MODEL || DEFAULT_GRID_MODEL;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatCompletion = {
  id: string;
  model: string;
  text: string;
  mocked: boolean;
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const json = (res: ServerResponse, status: number, body: unknown) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
};

/** A local /v1/chat/completions that answers with a fixed assistant line. Fetch follows no extra hops. */
export function serveMockOpenAI(reply = "reproduced it, opening a pull request"): Promise<{ url: string; close: () => Promise<void>; server: Server }> {
  const server: Server = createServer(async (req, res) => {
    const path = req.url ?? "";
    if (req.method === "POST" && (path === "/v1/chat/completions" || path === "/chat/completions")) {
      const raw = await readBody(req);
      let model = "mock";
      try {
        model = String((JSON.parse(raw) as { model?: unknown }).model ?? "mock");
      } catch {
        json(res, 400, { error: { message: "body is not JSON" } });
        return;
      }
      json(res, 200, {
        id: "mock-chat",
        object: "chat.completion",
        model,
        choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
      });
      return;
    }
    json(res, 404, { error: { message: `no ${req.method} ${path}` } });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("mock OpenAI had no port"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/v1`,
        server,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}

/** One chat completion against an OpenAI-compatible /chat/completions. Follows redirects, as Grid's 307 needs. */
export async function pingOpenAICompatible(options: {
  baseURL: string;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  mocked?: boolean;
}): Promise<ChatCompletion> {
  const base = options.baseURL.replace(/\/+$/, "");
  const url = `${base}/chat/completions`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      redirect: "follow",
      headers: {
        "content-type": "application/json",
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: options.model, messages: options.messages, max_tokens: 32 }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenAI-compatible ${url} failed: ${reason}`);
  }
  const body = (await response.json().catch(() => null)) as {
    id?: unknown;
    model?: unknown;
    choices?: { message?: { content?: unknown } }[];
    error?: { message?: unknown };
  } | null;
  if (!response.ok) {
    const reason = typeof body?.error?.message === "string" ? body.error.message : `HTTP ${response.status}`;
    throw new Error(`OpenAI-compatible ${url} failed: ${reason}`);
  }
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || text.length === 0) throw new Error(`OpenAI-compatible ${url} answered with no text`);
  return {
    id: typeof body?.id === "string" ? body.id : "chat",
    model: typeof body?.model === "string" ? body.model : options.model,
    text,
    mocked: options.mocked === true,
  };
}
