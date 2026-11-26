import type { NextConfig } from "next";

const config: NextConfig = {
  // Local `npx @vercel/board serve` and Playwright talk to 127.0.0.1; Next's default origin is localhost.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Read from disk at request time, so the deployment has to carry them: JOIN.md by /join.md, and the
  // runner when a run's first sandbox is built (by the page's actions and the cron).
  outputFileTracingIncludes: { "/join.md": ["./JOIN.md"], "/orc-board.sh": ["./scripts/orc-board.sh"] },
};

export default config;
