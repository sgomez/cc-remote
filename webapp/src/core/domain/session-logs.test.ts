import { describe, expect, it } from "vitest";
import { createLogSanitizer, sanitizeLogText } from "./session-logs";

const ESC = "\u001b";
const BEL = "\u0007";

describe("sanitizeLogText", () => {
  it("leaves plain text untouched", () => {
    expect(sanitizeLogText("fatal: repository not found\n")).toBe("fatal: repository not found\n");
  });

  it("strips SGR colour codes", () => {
    expect(sanitizeLogText(`${ESC}[32mready${ESC}[0m\n`)).toBe("ready\n");
  });

  // Verbatim shape of a real line from a running session container (ttyd's
  // logs), which is what drove this: a <pre> would otherwise render the escapes
  // as literal "[0m[35;1m" noise in front of every line.
  it("strips the escape soup a real ttyd container emits", () => {
    const real = `${ESC}[0m${ESC}[35;1m[2026/07/13 11:23:16:9039] N: started process, pid: 93\n`;

    expect(sanitizeLogText(real)).toBe("[2026/07/13 11:23:16:9039] N: started process, pid: 93\n");
  });

  it("strips OSC window-title sequences (BEL- and ST-terminated)", () => {
    expect(sanitizeLogText(`${ESC}]0;a title${BEL}hello`)).toBe("hello");
    expect(sanitizeLogText(`${ESC}]0;a title${ESC}\\hello`)).toBe("hello");
  });

  it("strips cursor moves and erase sequences", () => {
    expect(sanitizeLogText(`${ESC}[2J${ESC}[H${ESC}[1;31mboom${ESC}[m`)).toBe("boom");
  });

  it("normalises CRLF from a TTY to plain newlines", () => {
    expect(sanitizeLogText("line one\r\nline two\r\n")).toBe("line one\nline two\n");
  });

  it("leaves no escape character behind", () => {
    const messy = `${ESC}[36mcloning${ESC}[0m\r\n${ESC}[31mfailed${ESC}[0m\r\n`;

    expect(sanitizeLogText(messy)).not.toContain(ESC);
    expect(sanitizeLogText(messy)).toBe("cloning\nfailed\n");
  });

  it("keeps the content itself intact — nothing truncated or reordered", () => {
    const text = "step 1\nstep 2\nstep 3\n";

    expect(sanitizeLogText(text)).toBe(text);
  });

  it("handles empty output", () => {
    expect(sanitizeLogText("")).toBe("");
  });
});

describe("createLogSanitizer (streaming)", () => {
  /** Feed `text` one character at a time — the cruellest possible chunking. */
  function pushPerChar(text: string): string {
    const s = createLogSanitizer();
    return [...text].map((c) => s.push(c)).join("") + s.flush();
  }

  it("matches the one-shot sanitizer regardless of where the chunks fall", () => {
    const raw = `${ESC}[0m${ESC}[35;1m[11:23:16] N: started\r\n${ESC}[31mboom${ESC}[0m\r\n`;

    expect(pushPerChar(raw)).toBe(sanitizeLogText(raw));
    expect(pushPerChar(raw)).toBe("[11:23:16] N: started\nboom\n");
  });

  // The bug a one-shot read never had: a chunk that ends mid-escape. Emitting
  // the fragment immediately is what leaks "[32m" into the panel.
  it("holds back an escape split across two chunks", () => {
    const s = createLogSanitizer();

    expect(s.push(`ready${ESC}[3`)).toBe("ready");
    expect(s.push("2mgreen")).toBe("green");
    expect(s.flush()).toBe("");
  });

  it("holds back a CRLF split across two chunks", () => {
    const s = createLogSanitizer();

    expect(s.push("line one\r")).toBe("line one");
    expect(s.push("\nline two")).toBe("\nline two");
  });

  it("holds back an OSC sequence split across chunks", () => {
    const s = createLogSanitizer();

    expect(s.push(`${ESC}]0;my ti`)).toBe("");
    expect(s.push(`tle${BEL}done`)).toBe("done");
  });

  it("emits plain text immediately — no buffering when nothing is partial", () => {
    const s = createLogSanitizer();

    expect(s.push("cloning…\n")).toBe("cloning…\n");
    expect(s.push("done\n")).toBe("done\n");
  });

  // A lone ESC that never terminates must not swallow the log lines behind it
  // forever — that would hide exactly the output the user opened the panel for.
  it("gives up holding an ESC that never completes", () => {
    const s = createLogSanitizer();
    const long = "x".repeat(80);

    const out = s.push(`${ESC}${long}`) + s.flush();

    expect(out).toContain(long);
  });

  it("flushes a trailing partial escape when the stream ends", () => {
    const s = createLogSanitizer();
    s.push(`tail${ESC}[3`);

    // The container died mid-sequence; the fragment is all we will ever get.
    expect(s.flush()).toBe(`${ESC}[3`);
  });

  it("emits nothing for empty chunks", () => {
    const s = createLogSanitizer();

    expect(s.push("")).toBe("");
    expect(s.flush()).toBe("");
  });
});
