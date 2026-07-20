import { describe, expect, it } from "vitest";
import { LOGIN_LABELS, SESSION_LABELS } from "../../core";
import {
  cloneContainerName,
  decodeDockerLogs,
  isLoginLabelled,
  isSessionLabelled,
  loginContainerName,
  loginTerminalBasePath,
  mainContainerName,
  parseExitCode,
  toLoginContainer,
  toSessionContainer,
  ttydBasePath,
  ttydWebSocketUrl,
} from "./container-mapping";

describe("container name derivation", () => {
  it("names the main and clone containers from the session name", () => {
    expect(mainContainerName("demo")).toBe("cc-remote-session-demo");
    expect(cloneContainerName("demo")).toBe("cc-remote-session-clone-demo");
  });
});

describe("isSessionLabelled (the guard)", () => {
  it("accepts only containers carrying the session marker label", () => {
    expect(isSessionLabelled({ [SESSION_LABELS.marker]: "true" })).toBe(true);
  });

  it("rejects unlabelled, wrong-valued, and missing label sets", () => {
    expect(isSessionLabelled({ [SESSION_LABELS.marker]: "false" })).toBe(false);
    expect(isSessionLabelled({ other: "true" })).toBe(false);
    expect(isSessionLabelled({})).toBe(false);
    expect(isSessionLabelled(undefined)).toBe(false);
    expect(isSessionLabelled(null)).toBe(false);
  });
});

describe("toSessionContainer", () => {
  it("reads name/repo/accountId from labels and normalises the state", () => {
    const sc = toSessionContainer({
      labels: {
        [SESSION_LABELS.marker]: "true",
        [SESSION_LABELS.name]: "demo",
        [SESSION_LABELS.repo]: "octocat/hello",
        [SESSION_LABELS.accountId]: "acc-1",
        [SESSION_LABELS.permissionMode]: "bypassPermissions",
      },
      state: "running",
    });
    expect(sc).toEqual({
      name: "demo",
      repo: "octocat/hello",
      accountId: "acc-1",
      state: "running",
      exitCode: null,
      cloning: false,
      permissionMode: "bypassPermissions",
    });
  });

  // A Session created before the label existed. Reporting `null` rather than a
  // guessed default is what lets reset-session apply the deployment default,
  // which is the only layer that knows what it is.
  it("reports a null permission mode when the label is absent", () => {
    const sc = toSessionContainer({
      labels: {
        [SESSION_LABELS.marker]: "true",
        [SESSION_LABELS.name]: "legacy",
        [SESSION_LABELS.repo]: "octocat/hello",
        [SESSION_LABELS.accountId]: "acc-1",
      },
      state: "running",
    });
    expect(sc.permissionMode).toBeNull();
  });

  it("reports a null permission mode when the label holds a mode we do not offer", () => {
    const sc = toSessionContainer({
      labels: {
        [SESSION_LABELS.marker]: "true",
        [SESSION_LABELS.name]: "odd",
        [SESSION_LABELS.repo]: "octocat/hello",
        [SESSION_LABELS.accountId]: "acc-1",
        [SESSION_LABELS.permissionMode]: "plan",
      },
      state: "running",
    });
    expect(sc.permissionMode).toBeNull();
  });

  it("marks cloning helpers via the cloning label", () => {
    const sc = toSessionContainer({
      labels: {
        [SESSION_LABELS.marker]: "true",
        [SESSION_LABELS.name]: "demo",
        [SESSION_LABELS.repo]: "octocat/hello",
        [SESSION_LABELS.accountId]: "acc-1",
        [SESSION_LABELS.cloning]: "true",
      },
      state: "exited",
    });
    expect(sc.cloning).toBe(true);
    expect(sc.state).toBe("exited");
  });

  it("passes an exit code through, and defaults a missing one to null", () => {
    const crashed = toSessionContainer({
      labels: { [SESSION_LABELS.name]: "demo" },
      state: "exited",
      exitCode: 3,
    });
    expect(crashed.exitCode).toBe(3);
    // Absent (the caller could not read one) is null, never 0 — the domain
    // must be able to tell "clean exit" from "we don't know".
    const unknown = toSessionContainer({
      labels: { [SESSION_LABELS.name]: "demo" },
      state: "exited",
    });
    expect(unknown.exitCode).toBeNull();
  });

  it("does not synthesize status — raw state only", () => {
    // A cloning helper that exited is 'exited' here; the domain maps that to
    // 'clone_failed', never the adapter.
    const sc = toSessionContainer({
      labels: { [SESSION_LABELS.cloning]: "true" },
      state: "exited",
    });
    expect(sc.state).toBe("exited");
  });
});

describe("parseExitCode", () => {
  // `docker.listContainers()` returns a ContainerInfo with NO exit code field —
  // its human-readable `Status` string is the only place the code appears, so
  // the LIST path (and the 1s SSE stream it feeds) has to read it from there.
  it.each([
    ["Exited (0) 2 seconds ago", 0],
    ["Exited (137) 2 minutes ago", 137],
    ["Exited (143) About a minute ago", 143],
    ["Exited (3) 11 seconds ago", 3],
  ])("reads the code out of %s", (status, expected) => {
    expect(parseExitCode(status)).toBe(expected);
  });

  it.each([
    ["Up 3 hours", "a running container carries no exit code"],
    ["Up 2 minutes (Paused)", "paused"],
    ["Created", "never started"],
    ["Restarting (1) 4 seconds ago", "still restarting, not a terminal exit"],
    ["Removal In Progress", "teardown"],
    ["Dead", "dead"],
    ["", "empty"],
    ["Exited (abc) 1 second ago", "unparseable code"],
  ])("returns null for %s (%s)", (status) => {
    expect(parseExitCode(status)).toBeNull();
  });
});

describe("ttydBasePath", () => {
  it("matches the agent image CMD base path", () => {
    expect(ttydBasePath("demo")).toBe("/api/sessions/demo/terminal");
  });
});

describe("login container mapping", () => {
  it("names the login container from the account id", () => {
    expect(loginContainerName("acc-1")).toBe("cc-remote-login-acc-1");
  });

  it("guards on the login marker, distinct from the session marker", () => {
    expect(isLoginLabelled({ [LOGIN_LABELS.marker]: "true" })).toBe(true);
    expect(isLoginLabelled({ [SESSION_LABELS.marker]: "true" })).toBe(false);
    expect(isLoginLabelled({})).toBe(false);
    expect(isLoginLabelled(undefined)).toBe(false);
    expect(isLoginLabelled(null)).toBe(false);
  });

  it("reads the account id from labels and passes state through", () => {
    const lc = toLoginContainer({
      labels: { [LOGIN_LABELS.marker]: "true", [LOGIN_LABELS.accountId]: "acc-1" },
      state: "running",
    });
    expect(lc).toEqual({ accountId: "acc-1", state: "running" });
  });

  it("exposes a login terminal base path mirroring the session one", () => {
    expect(loginTerminalBasePath("acc-1")).toBe("/api/accounts/acc-1/login/terminal");
  });
});

describe("ttydWebSocketUrl", () => {
  it("targets the agent container's ttyd socket on the compose network", () => {
    expect(ttydWebSocketUrl("demo")).toBe(
      "ws://cc-remote-session-demo:7681/api/sessions/demo/terminal/ws",
    );
  });

  it("stays composed from the container name and base path (single source of truth)", () => {
    expect(ttydWebSocketUrl("demo")).toBe(
      `ws://${mainContainerName("demo")}:7681${ttydBasePath("demo")}/ws`,
    );
  });
});

/** Build one Docker multiplexed log frame (the non-TTY wire format). */
function frame(type: number, text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

describe("decodeDockerLogs", () => {
  // Our containers are created with `Tty: true`, so this is the format we
  // actually receive: raw bytes, no framing to strip.
  it("returns a raw TTY stream verbatim", () => {
    expect(decodeDockerLogs(Buffer.from("hello agent\r\n", "utf8"))).toBe("hello agent\r\n");
  });

  it("keeps ANSI escapes in a raw TTY stream intact", () => {
    const ansi = "\u001b[32mready\u001b[0m\r\n";
    expect(decodeDockerLogs(Buffer.from(ansi, "utf8"))).toBe(ansi);
  });

  // Robustness: a non-TTY container (or a future spec change) would frame its
  // output, and the headers must be stripped rather than rendered as junk.
  it("de-multiplexes a framed stream, concatenating stdout and stderr in order", () => {
    const buffer = Buffer.concat([
      frame(1, "cloning…\n"),
      frame(2, "fatal: repository not found\n"),
      frame(1, "done\n"),
    ]);

    expect(decodeDockerLogs(buffer)).toBe("cloning…\nfatal: repository not found\ndone\n");
  });

  it("strips the 8-byte header rather than leaking framing bytes into the text", () => {
    const decoded = decodeDockerLogs(frame(1, "plain line\n"));

    expect(decoded).toBe("plain line\n");
    expect(decoded).not.toContain("\u0000");
  });

  it("handles multi-byte UTF-8 split across the payload of a frame", () => {
    expect(decodeDockerLogs(frame(1, "café ✓\n"))).toBe("café ✓\n");
  });

  it("returns empty text for an empty buffer", () => {
    expect(decodeDockerLogs(Buffer.alloc(0))).toBe("");
  });

  // A truncated/implausible header means "this isn't framed" — fall back to raw
  // rather than dropping the user's logs on the floor.
  it("falls back to raw text when the framing does not walk cleanly to the end", () => {
    const truncated = Buffer.concat([frame(1, "ok\n"), Buffer.from([1, 0, 0, 0, 0, 0, 0])]);

    expect(decodeDockerLogs(truncated)).toContain("ok\n");
  });

  it("treats a frame whose declared length overruns the buffer as raw text", () => {
    const header = Buffer.alloc(8);
    header.writeUInt8(1, 0);
    header.writeUInt32BE(999, 4);
    const overrun = Buffer.concat([header, Buffer.from("short", "utf8")]);

    expect(decodeDockerLogs(overrun)).toContain("short");
  });
});
