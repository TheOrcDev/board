/** Who shows on the grid when the board is quiet: idle tiles, seeded, so the hero shot is never empty. */

export const GROUPS = ["grok", "claude", "codex"] as const;
export type AgentGroup = (typeof GROUPS)[number];

export const MACHINES = ["mac", "ogre", "cloud"] as const;
export type AgentMachine = (typeof MACHINES)[number];

export const STATUSES = ["working", "waiting", "blocked", "idle", "rate-limited"] as const;
export type AgentStatus = (typeof STATUSES)[number];

/** Board's rule for a profile name: a letter, then up to 31 letters, digits, or hyphens (32 total). */
export const PROFILE_NAME = /^[A-Za-z][A-Za-z0-9-]{0,31}$/;

export type RosterAgent = {
  /** Board profile, lowercase. */
  id: string;
  name: string;
  group: AgentGroup;
  machine: AgentMachine;
  /** Short role shown under the name, when it isn't the name. */
  role: string | null;
  initials: string;
};

const grok = (id: string, name: string, initials: string, role: string | null = null): RosterAgent => ({
  id,
  name,
  group: "grok",
  machine: "cloud",
  role,
  initials,
});

const claude = (id: string, name: string, initials: string, role: string): RosterAgent => ({
  id,
  name,
  group: "claude",
  machine: "mac",
  role,
  initials,
});

const codex = (id: string, name: string, initials: string, machine: AgentMachine, role: string | null = null): RosterAgent => ({
  id,
  name,
  group: "codex",
  machine,
  role,
  initials,
});

/** Seeded agents. Empty tiles still render as idle. Unknown heartbeats join at the end of their group. */
export const ROSTER: readonly RosterAgent[] = [
  grok("orc", "Orc", "O"),
  grok("dev", "Dev", "D"),
  grok("ogre", "Ogre", "Og"),
  grok("xorc", "Xorc", "X"),
  grok("finance-orc", "Finance Orc", "FO"),
  grok("health-orc", "Health Orc", "HO"),
  grok("newsletter-orc", "Newsletter Orc", "NO"),
  grok("content-orc", "Content Orc", "CO"),
  grok("video-techy-orc", "Video Techy Orc", "VT"),
  grok("cmo-orc", "Chief Orc Marketing Officer", "CM", "CMO"),
  grok("chef-orc", "Chef Orc", "CH"),
  grok("seo-orc", "SEO Orc", "SE"),
  grok("videorc", "Videorc", "V"),
  grok("sponsorship-orc", "Sponsorship Hunter Orc", "SH"),
  grok("memory-orc", "Memory Orc", "MO"),
  claude("claude-main", "claude-main", "CM", "main"),
  claude("claude-troll", "claude-troll", "CT", "support"),
  claude("claude-goblin", "claude-goblin", "CG", "feedback"),
  claude("claude-tauren", "claude-tauren", "CA", "billing"),
  claude("claude-videorc", "claude-videorc", "CV", "video"),
  codex("codex-hub", "codex-hub", "CH", "mac", "hub"),
  codex("videorc-main", "videorc-main", "VM", "mac"),
  codex("videorc-orchestrator", "Videorc orchestrator", "VO", "mac", "orchestrator"),
];

export const ROSTER_BY_ID = new Map(ROSTER.map((agent) => [agent.id, agent]));

export const GROUP_TITLE: Record<AgentGroup, string> = {
  grok: "Grok Bots",
  claude: "Claude Hub",
  codex: "Codex Hub",
};

export const GROUP_FALLBACK: Record<AgentGroup, "grok" | "claude" | "codex"> = {
  grok: "grok",
  claude: "claude",
  codex: "codex",
};

export const MACHINE_LABEL: Record<AgentMachine, string> = {
  mac: "Mac",
  ogre: "Ogre",
  cloud: "cloud",
};

export const STATUS_LABEL: Record<AgentStatus, string> = {
  working: "working",
  waiting: "waiting on OrcDev",
  blocked: "blocked",
  idle: "idle",
  "rate-limited": "rate-limited",
};

/** Whether `name` is a board profile: a letter, then letters, digits, hyphens, at most 32 characters. */
export const isProfileName = (name: string) => PROFILE_NAME.test(name);

export function parseGroup(value: unknown): AgentGroup | null {
  return typeof value === "string" && (GROUPS as readonly string[]).includes(value) ? (value as AgentGroup) : null;
}

export function parseMachine(value: unknown): AgentMachine | null {
  return typeof value === "string" && (MACHINES as readonly string[]).includes(value) ? (value as AgentMachine) : null;
}

export function parseStatus(value: unknown): AgentStatus | null {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value) ? (value as AgentStatus) : null;
}

/** Group for an unknown agent that heartbeats: its payload, else `claude-*` / `codex-*`, else Grok. */
export function groupOf(id: string, group?: AgentGroup | null): AgentGroup {
  if (group) return group;
  if (id.startsWith("claude-")) return "claude";
  if (id.startsWith("codex-")) return "codex";
  return "grok";
}

export function machineOf(id: string, group: AgentGroup, machine?: AgentMachine | null): AgentMachine {
  if (machine) return machine;
  const known = ROSTER_BY_ID.get(id);
  if (known) return known.machine;
  if (group === "grok") return "cloud";
  return "mac";
}

const titleCase = (id: string) =>
  id
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");

const initialsOf = (id: string, name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]!.slice(0, 1) + words[1]!.slice(0, 1)).toUpperCase();
  const parts = id.split("-").filter(Boolean);
  if (parts.length >= 2) return (parts[0]!.slice(0, 1) + parts[1]!.slice(0, 1)).toUpperCase();
  return name.slice(0, 2).toUpperCase() || id.slice(0, 2).toUpperCase();
};

/** A seeded agent, or one that heartbeated and isn't on the roster yet. */
export function describeAgent(id: string, group?: AgentGroup | null, machine?: AgentMachine | null): RosterAgent {
  const known = ROSTER_BY_ID.get(id);
  if (known) {
    return {
      ...known,
      group: group ?? known.group,
      machine: machine ?? known.machine,
    };
  }
  const placed = groupOf(id, group);
  const name = titleCase(id);
  return {
    id,
    name,
    group: placed,
    machine: machineOf(id, placed, machine),
    role: null,
    initials: initialsOf(id, name),
  };
}

const GROUP_HUE: Record<AgentGroup, number> = { grok: 148, claude: 18, codex: 228 };

function hueOf(id: string, group: AgentGroup): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 33 + id.charCodeAt(i)) >>> 0;
  return GROUP_HUE[group] + (hash % 18) - 8;
}

/** A monogram avatar for the tile: group colour, two letters. Used when the agent sent no picture. */
export function monogramAvatar(agent: Pick<RosterAgent, "id" | "group" | "initials">): string {
  const hue = hueOf(agent.id, agent.group);
  const bg = `hsl(${hue} 42% 16%)`;
  const fg = `hsl(${hue} 72% 72%)`;
  const ring = `hsl(${hue} 50% 32%)`;
  const letters = agent.initials.slice(0, 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="36" fill="${bg}" stroke="${ring}" stroke-width="4"/><text x="64" y="78" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="48" font-weight="700" fill="${fg}">${letters}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Board built-in marks, served by this app at `/avatars/<name>` so the grid never needs the board's URL. */
export const FALLBACK_AVATAR = (group: AgentGroup) => `/avatars/${GROUP_FALLBACK[group]}`;
