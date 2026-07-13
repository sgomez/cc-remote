import { describe, expect, it } from "vitest";
import { sanitizeLogText } from "./session-logs";

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
