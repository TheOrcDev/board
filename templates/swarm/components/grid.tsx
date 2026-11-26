"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { answer, say, thread } from "@/lib/client";
import { GROUP_TITLE, MACHINE_LABEL, STATUS_LABEL, type AgentGroup, type AgentStatus } from "@/lib/roster";
import type { AgentTile, Line, Need, Snapshot, Task } from "@/lib/swarm";
import { WebMcp } from "@/components/webmcp";

type History = Awaited<ReturnType<typeof thread>>;

const GROUPS: AgentGroup[] = ["grok", "claude", "codex"];

function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}
const ago = (at: string, now: number) => span(now - Date.parse(at));
const firstLine = (text: string) => text.split("\n", 1)[0] || "(empty)";

export function Grid({ first, task: firstTask, log: firstLog }: { first: Snapshot; task: string | null; log?: boolean }) {
  const [snap, setSnap] = useState(first);
  const [live, setLive] = useState<"live" | "reconnecting" | { problem: string }>("live");
  const [open, setOpen] = useState(firstTask);
  const [logOpen, setLogOpen] = useState(Boolean(firstLog));
  const [now, setNow] = useState(() => Date.parse(first.at));

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/live");
    source.addEventListener("snapshot", (event) => {
      setSnap(JSON.parse((event as MessageEvent<string>).data) as Snapshot);
      setLive("live");
      setNow(Date.now());
    });
    source.addEventListener("ping", () => setLive("live"));
    source.addEventListener("problem", (event) => setLive({ problem: (JSON.parse((event as MessageEvent<string>).data) as { message: string }).message }));
    source.onerror = () => setLive((state) => (state === "live" ? "reconnecting" : state));
    return () => source.close();
  }, []);

  useEffect(() => {
    const query = [open && `task=${encodeURIComponent(open)}`, logOpen && "log=1"].filter(Boolean);
    window.history.replaceState(null, "", query.length ? `?${query.join("&")}` : window.location.pathname);
  }, [open, logOpen]);

  const selected = open ? snap.tasks.find((task) => task.id === open) ?? null : null;
  const log = useMemo(() => {
    const seen = new Set<string>();
    const rows: Line[] = [];
    for (const entry of [...snap.agentsFlow, ...snap.flow]) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      rows.push(entry);
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at));
  }, [snap]);

  return (
    <div className="shell" data-panel={open ? "open" : "closed"} data-log={logOpen ? "open" : "closed"}>
      <WebMcp snap={snap} show={setOpen} />
      <header>
        <div className="brand-block">
          <p className="kicker">OrcDev</p>
          <h1>{snap.name} grid</h1>
        </div>
        <span className="state" data-live={typeof live === "string" ? live : "down"}>
          <i aria-hidden />
          {typeof live === "string" ? live : `down: ${live.problem}`}
        </span>
        <div className="header-actions">
          <button type="button" className="ghost" data-testid="log-toggle" aria-pressed={logOpen} onClick={() => setLogOpen((on) => !on)}>
            Log
          </button>
          <a className="ghost" href="/join.md">
            Join
          </a>
          <a className="ghost" href="https://vercel.com/docs/board">
            Docs
          </a>
        </div>
      </header>

      <section className="counts" aria-label="Task counts">
        <Count label="ready" value={snap.counts.ready} tone="ready" />
        <Count label="claimed" value={snap.counts.claimed} tone="working" />
        <Count label="blocked" value={snap.counts.blocked} tone="held" />
        <Count label="done today" value={snap.counts.doneToday} tone="done" plus={snap.finishedCapped} />
      </section>

      <NeedsLane needs={snap.needs} now={now} show={setOpen} />

      <div className="board">
        {GROUPS.map((group) => (
          <section key={group} className="hub" data-group={group}>
            <h2>
              <span>{GROUP_TITLE[group]}</span>
              <span className="faint">{snap.agents.filter((agent) => agent.group === group).length}</span>
            </h2>
            <ul className="tiles">
              {snap.agents
                .filter((agent) => agent.group === group)
                .map((agent) => (
                  <li key={agent.id}>
                    <Tile
                      agent={agent}
                      now={now}
                      selected={open === agent.thread || open === agent.taskId}
                      onOpen={() => {
                        const id = agent.taskId ?? agent.thread;
                        if (id) setOpen(id);
                      }}
                    />
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>

      {logOpen && (
        <section className="log pane" data-testid="author-log" aria-label="Verified author log">
          <h2>
            Log <span className="faint">{log.length}</span>
          </h2>
          {log.length === 0 ? (
            <p className="faint pad">Nothing on the board yet.</p>
          ) : (
            <ul className="rows">
              {log.slice(0, 80).map((entry) => (
                <li key={entry.id}>
                  <button type="button" onClick={() => setOpen(entry.re ?? entry.id)} title={entry.text}>
                    <time>{ago(entry.at, now)}</time>
                    <span className="who" title={entry.author}>
                      {entry.author}
                    </span>
                    <span className="chip" data-verified={entry.verified ? "yes" : "no"}>
                      {entry.verified ? "verified" : "unverified"}
                    </span>
                    {entry.profile && <span className="chip">{entry.profile}</span>}
                    {entry.via && <span className="faint">via {entry.via}</span>}
                    <span className="text">
                      {entry.re && <span className="faint">↳ </span>}
                      {firstLine(entry.text)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {open && (
        <aside className="pane panel" aria-label="Thread">
          <Panel id={open} task={selected} now={now} onClose={() => setOpen(null)} />
        </aside>
      )}
    </div>
  );
}

function Count({ label, value, tone, plus }: { label: string; value: number; tone: string; plus?: boolean }) {
  return (
    <div className="count" data-tone={tone}>
      <b>
        {value}
        {plus ? "+" : ""}
      </b>
      <span>{label}</span>
    </div>
  );
}

function NeedsLane({ needs, now, show }: { needs: Need[]; now: number; show: (id: string) => void }) {
  return (
    <section className="needs" data-lit={needs.length > 0 ? "yes" : "no"} aria-label="Needs OrcDev">
      <h2>
        Needs OrcDev
        <span className="faint">{needs.length === 0 ? "clear" : `${needs.length} waiting`}</span>
      </h2>
      {needs.length === 0 ? (
        <p className="faint pad">No blocked tasks. Agents block with a question when they need you.</p>
      ) : (
        <ul className="need-cards">
          {needs.map((need) => (
            <li key={need.id}>
              <button type="button" className="need-head" onClick={() => show(need.id)}>
                <strong>{need.title}</strong>
                <span className="faint">
                  {need.agent ?? "agent"} · {ago(need.at, now)} ago
                </span>
              </button>
              <p className="question">{need.question}</p>
              <AnswerBox id={need.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AnswerBox({ id }: { id: string }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<{ busy: boolean; said: string | null; bad: boolean }>({ busy: false, said: null, bad: false });
  async function submit() {
    if (!text.trim() || state.busy) return;
    setState({ busy: true, said: null, bad: false });
    const result = await answer(id, text);
    if (result.ok) {
      setText("");
      setState({ busy: false, said: "Sent.", bad: false });
    } else setState({ busy: false, said: result.problem, bad: true });
  }
  return (
    <form
      className="answer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <input
        value={text}
        placeholder="Answer and unblock…"
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" disabled={state.busy || !text.trim()}>
        {state.busy ? "Sending" : "Answer"}
      </button>
      {state.said && <span className={state.bad ? "bad" : "faint"}>{state.said}</span>}
    </form>
  );
}

function Tile({ agent, now, selected, onOpen }: { agent: AgentTile; now: number; selected: boolean; onOpen: () => void }) {
  const prev = useRef(`${agent.status}:${agent.taskTitle}:${agent.last?.id ?? ""}`);
  const signature = `${agent.status}:${agent.taskTitle}:${agent.last?.id ?? ""}`;
  const flash = prev.current !== signature;
  useEffect(() => {
    prev.current = signature;
  }, [signature]);
  return (
    <button type="button" className="tile" data-agent={agent.id} data-status={agent.status} data-flash={flash ? "yes" : "no"} aria-pressed={selected} onClick={onOpen}>
      <span className="face">
        <img src={agent.avatar} alt="" width={56} height={56} onError={(event) => { event.currentTarget.src = agent.fallback; }} />
        <i data-status={agent.status} aria-hidden />
      </span>
      <span className="meta">
        <span className="name">{agent.name}</span>
        <span className="badges">
          <span className="machine">{MACHINE_LABEL[agent.machine]}</span>
          <span className="pill" data-status={agent.status}>
            {STATUS_LABEL[agent.status as AgentStatus]}
          </span>
        </span>
        <span className="task">{agent.taskTitle ?? (agent.role ? agent.role : "no task")}</span>
        <span className="last">
          {agent.last ? (
            <>
              {firstLine(agent.last.text)} · {ago(agent.last.at, now)} ago
            </>
          ) : (
            "idle"
          )}
        </span>
      </span>
    </button>
  );
}

function Panel({ id, task, now, onClose }: { id: string; task: Task | null; now: number; onClose: () => void }) {
  const [history, setHistory] = useState<History | { problem: string } | null>(null);
  const version = task ? `${task.state}:${task.holder}:${task.replies}:${task.last?.id}` : id;

  useEffect(() => {
    let stale = false;
    thread(id).then(
      (loaded) => !stale && setHistory(loaded),
      (error: unknown) => !stale && setHistory({ problem: (error as Error).message }),
    );
    return () => {
      stale = true;
    };
  }, [id, version]);

  return (
    <>
      <h2 className="head">
        <span>{task ? task.title : "Thread"}</span>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </h2>
      {history === null ? (
        <p className="faint pad">Loading…</p>
      ) : "problem" in history ? (
        <p className="pad bad">
          Couldn&apos;t read {id}: {history.problem}
        </p>
      ) : (
        <div className="thread">
          {task && (
            <p className="chips">
              <span className="state-chip">
                <i data-state={task.state} aria-hidden />
                {task.state}
              </span>
              {task.holder && <span className="who">{task.holder}</span>}
              <span className="faint">{id}</span>
            </p>
          )}
          {task?.note && <p className="note">{task.note}</p>}
          <Entry line={history.root} now={now} />
          <h3>
            Thread <span className="faint">{history.replies.length}</span>
          </h3>
          {history.replies.length === 0 && <p className="faint">no replies yet</p>}
          {history.replies.map((reply) => (
            <Entry key={reply.id} line={reply} now={now} />
          ))}
          <Composer id={id} />
        </div>
      )}
    </>
  );
}

function Composer({ id }: { id: string }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<{ busy: boolean; said: string | null; bad: boolean }>({ busy: false, said: null, bad: false });
  async function submit() {
    if (!text.trim() || state.busy) return;
    setState({ busy: true, said: null, bad: false });
    const result = await say(id, text);
    if (result.ok) {
      setText("");
      setState({ busy: false, said: "Sent.", bad: false });
    } else setState({ busy: false, said: result.problem, bad: true });
  }
  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        value={text}
        rows={2}
        placeholder="Reply in this thread…"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="composer-foot">
        <span className={state.bad ? "bad" : "faint"}>{state.said ?? "⌘↵ to send"}</span>
        <button type="submit" disabled={state.busy || !text.trim()}>
          {state.busy ? "Sending" : "Reply"}
        </button>
      </div>
    </form>
  );
}

function Entry({ line, now }: { line: Line; now: number }) {
  return (
    <article>
      <p className="by">
        <span className="who">{line.author}</span>
        {line.profile && <span className="chip">{line.profile}</span>}
        {line.via && <span className="faint">via {line.via}</span>}
        <span className="chip" data-verified={line.verified ? "yes" : "no"}>
          {line.verified ? "verified" : "unverified"}
        </span>
        <time dateTime={line.at}>{ago(line.at, now)} ago</time>
      </p>
      <p className="body">{line.text}</p>
    </article>
  );
}
