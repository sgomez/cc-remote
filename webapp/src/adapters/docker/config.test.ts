import { describe, expect, it } from "vitest";
import {
  AgentLimitError,
  configFromEnv,
  MIN_MEMORY_BYTES,
  parseDockerHost,
  parseMemoryBytes,
  parseNanoCpus,
} from "./config";

const MB = 1024 ** 2;
const GB = 1024 ** 3;

describe("parseMemoryBytes", () => {
  it("accepts human units, case-insensitively, with or without a trailing b", () => {
    expect(parseMemoryBytes("512m")).toBe(512 * MB);
    expect(parseMemoryBytes("512M")).toBe(512 * MB);
    expect(parseMemoryBytes("512mb")).toBe(512 * MB);
    expect(parseMemoryBytes("2g")).toBe(2 * GB);
    expect(parseMemoryBytes("2G")).toBe(2 * GB);
    expect(parseMemoryBytes("1.5g")).toBe(1.5 * GB);
    expect(parseMemoryBytes("16384k")).toBe(16 * MB);
  });

  it("treats a bare number as bytes, like docker run --memory", () => {
    // The trap the old Number.parseInt code fell into in reverse: a plain number
    // must stay bytes, so an existing byte-valued .env keeps working.
    expect(parseMemoryBytes("2147483648")).toBe(2 * GB);
  });

  it("NEVER silently reads '2g' as 2 bytes (the bug this replaces)", () => {
    // Number.parseInt("2g", 10) === 2 -> a 2-BYTE limit. Regression guard.
    expect(parseMemoryBytes("2g")).not.toBe(2);
    expect(parseMemoryBytes("2048m")).not.toBe(2048);
  });

  it("treats unset/empty as no limit", () => {
    expect(parseMemoryBytes(undefined)).toBe(0);
    expect(parseMemoryBytes("")).toBe(0);
    expect(parseMemoryBytes("   ")).toBe(0);
  });

  it("treats an explicit 0 as the documented opt-out, not an error", () => {
    expect(parseMemoryBytes("0")).toBe(0);
    expect(parseMemoryBytes("0m")).toBe(0);
  });

  it("rejects a value under Docker's 6m minimum rather than clamping it", () => {
    expect(() => parseMemoryBytes("1024")).toThrow(AgentLimitError);
    expect(() => parseMemoryBytes("5m")).toThrow(/at least 6291456 bytes/);
    expect(parseMemoryBytes("6m")).toBe(MIN_MEMORY_BYTES);
  });

  it("rejects garbage loudly instead of falling back to unlimited", () => {
    for (const bad of ["lots", "2gb!", "-1", "-2g", "2 gigs", "1e9", "g", "512 m b"]) {
      expect(() => parseMemoryBytes(bad), bad).toThrow(AgentLimitError);
    }
  });

  it("names the offending variable in the message", () => {
    expect(() => parseMemoryBytes("nope", "AGENT_MEMORY_LIMIT")).toThrow(/AGENT_MEMORY_LIMIT/);
  });
});

describe("parseNanoCpus", () => {
  it("converts cores to nano-CPUs", () => {
    expect(parseNanoCpus("1")).toBe(1_000_000_000);
    expect(parseNanoCpus("1.5")).toBe(1_500_000_000);
    expect(parseNanoCpus("0.5")).toBe(500_000_000);
    expect(parseNanoCpus("6")).toBe(6_000_000_000);
  });

  it("treats unset/empty/0 as no limit", () => {
    expect(parseNanoCpus(undefined)).toBe(0);
    expect(parseNanoCpus("")).toBe(0);
    expect(parseNanoCpus("0")).toBe(0);
  });

  it("rejects garbage and negatives", () => {
    for (const bad of ["one", "-1", "1.5 cores", "1,5", "1e3"]) {
      expect(() => parseNanoCpus(bad), bad).toThrow(AgentLimitError);
    }
  });
});

describe("configFromEnv", () => {
  it("parses the human-unit limits into the adapter config", () => {
    const config = configFromEnv({
      AGENT_MEMORY_LIMIT: "2g",
      AGENT_CPU_LIMIT: "1.5",
      AGENT_PIDS_LIMIT: "512",
    });
    expect(config.memoryLimit).toBe(2 * GB);
    expect(config.nanoCpus).toBe(1_500_000_000);
    expect(config.pidsLimit).toBe(512);
  });

  it("leaves the limits unset when the env says nothing", () => {
    const config = configFromEnv({});
    expect(config.memoryLimit).toBeUndefined();
    expect(config.nanoCpus).toBeUndefined();
    expect(config.pidsLimit).toBe(4096);
    // The agents network default is the fail-safe one (never the proxy's).
    expect(config.network).toBe("cc-remote-agents");
  });

  it("throws on an invalid limit rather than starting every agent unbounded", () => {
    expect(() => configFromEnv({ AGENT_MEMORY_LIMIT: "2 gigs" })).toThrow(AgentLimitError);
    expect(() => configFromEnv({ AGENT_CPU_LIMIT: "all" })).toThrow(AgentLimitError);
  });

  it("still falls back for a bad pids limit — that fallback is itself a limit", () => {
    expect(configFromEnv({ AGENT_PIDS_LIMIT: "nonsense" }).pidsLimit).toBe(4096);
  });
});

describe("parseDockerHost", () => {
  it("parses the socket-proxy tcp form", () => {
    expect(parseDockerHost("tcp://docker-socket-proxy:2375")).toEqual({
      protocol: "http",
      host: "docker-socket-proxy",
      port: 2375,
    });
  });

  it("falls back to the raw socket", () => {
    expect(parseDockerHost(undefined)).toEqual({ socketPath: "/var/run/docker.sock" });
  });
});
