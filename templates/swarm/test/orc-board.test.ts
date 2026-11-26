import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts/orc-board.sh");
const BYPASS = "bypass.token-1";

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });

const runScript = (origin: string, bypass: string) =>
  new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("sh", [script, "hb", "idle"], {
      env: {
        ...process.env,
        ORC_BOARD_URL: origin,
        ORC_BOARD_SECRET: "ingest-secret",
        ORC_AGENT: "orc",
        ORC_GROUP: "grok",
        ORC_MACHINE: "cloud",
        ORC_BYPASS: bypass,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });

test("orc-board.sh sends ORC_BYPASS as one protection header, not split arguments", async () => {
  const seen: { bypass: string | undefined; authorization: string | undefined; noop: string | undefined; url: string; body: string }[] = [];
  const server = createServer((request, response) => {
    void readBody(request).then((body) => {
      seen.push({
        bypass: request.headers["x-vercel-protection-bypass"] as string | undefined,
        authorization: request.headers.authorization,
        noop: request.headers["x-orc-noop"] as string | undefined,
        url: request.url ?? "",
        body,
      });
      if (request.headers["x-vercel-protection-bypass"] !== BYPASS) {
        response.writeHead(401, { "content-type": "text/plain" });
        response.end("unauthorized");
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, throttled: false }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const missing = await runScript(origin, "");
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /401|unauthorized|curl/i);

    const ok = await runScript(origin, BYPASS);
    assert.equal(ok.status, 0, ok.stderr || ok.stdout);
    assert.match(ok.stdout, /"ok":\s*true/);
    assert.equal(seen.at(-1)?.bypass, BYPASS);
    assert.equal(seen.at(-1)?.authorization, "Bearer ingest-secret");
    assert.equal(seen.at(-1)?.url, "/api/ingest");
    assert.match(seen.at(-1)?.body ?? "", /"action":"heartbeat"/);
    assert.equal(seen.at(-1)?.noop, undefined);
  } finally {
    server.close();
  }
});

test("JOIN.md downloads orc-board.sh with the protection bypass header", () => {
  const joinMd = readFileSync(join(root, "JOIN.md"), "utf8");
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const download = 'curl -fsSL -H "x-vercel-protection-bypass: $ORC_BYPASS" "$ORC_BOARD_URL/orc-board.sh"';
  assert.ok(joinMd.includes(download));
  assert.ok(readme.includes(download));
});
