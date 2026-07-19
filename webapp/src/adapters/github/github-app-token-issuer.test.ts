import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryNotGrantedError } from "../../core/domain/errors";
import {
  createGitHubAppTokenIssuer,
  type GitHubAppTokenIssuerConfig,
} from "./github-app-token-issuer";

// Generate a real RSA key pair so crypto.createSign("RSA-SHA256") can sign the
// JWT. The tests mock fetch, not crypto — the JWT is signed for real, but the
// HTTP calls are intercepted before they leave the process.
const { privateKey: testKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

const TEST_KEY_BASE64 = Buffer.from(testKey).toString("base64");

const VALID_CONFIG: GitHubAppTokenIssuerConfig = {
  appId: "12345",
  privateKey: TEST_KEY_BASE64,
};

function installationResponse(installationId: number) {
  return {
    status: 200,
    ok: true,
    json: async () => ({ id: installationId }),
    text: async () => "",
  };
}

function tokenResponse(token: string, expiresAt: string) {
  return {
    status: 201,
    ok: true,
    json: async () => ({ token, expires_at: expiresAt }),
    text: async () => "",
  };
}

describe("createGitHubAppTokenIssuer", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let issuer: ReturnType<typeof createGitHubAppTokenIssuer>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    issuer = createGitHubAppTokenIssuer(VALID_CONFIG);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves the installation and mints a repo-scoped token", async () => {
    fetchSpy
      .mockResolvedValueOnce(installationResponse(42))
      .mockResolvedValueOnce(tokenResponse("ghs_test", "2026-07-19T12:00:00Z"));

    const cred = await issuer.issueToken("owner/repo");

    expect(cred.token).toBe("ghs_test");
    expect(cred.expiresAt).toEqual(new Date("2026-07-19T12:00:00Z"));
  });

  it("resolves the installation with a JWT in the Authorization header", async () => {
    fetchSpy
      .mockResolvedValueOnce(installationResponse(42))
      .mockResolvedValueOnce(tokenResponse("x", "2026-07-19T12:00:00Z"));

    await issuer.issueToken("owner/repo");

    const [installUrl, installOpts] = fetchSpy.mock.calls[0];
    expect(installUrl).toBe("https://api.github.com/repos/owner/repo/installation");
    expect(installOpts.headers.Authorization).toMatch(/^Bearer /);
    expect(installOpts.headers.Accept).toBe("application/vnd.github+json");
  });

  it("mints a token restricted to the given repository", async () => {
    fetchSpy
      .mockResolvedValueOnce(installationResponse(7))
      .mockResolvedValueOnce(tokenResponse("x", "2026-07-19T12:00:00Z"));

    await issuer.issueToken("myorg/myrepo");

    const [, tokenOpts] = fetchSpy.mock.calls[1];
    expect(tokenOpts.method).toBe("POST");
    const body = JSON.parse(tokenOpts.body);
    expect(body.repositories).toEqual(["myrepo"]);
    expect(body.permissions).toEqual({ contents: "write", pull_requests: "write" });
  });

  it("mints the token against the resolved installation id", async () => {
    fetchSpy
      .mockResolvedValueOnce(installationResponse(99))
      .mockResolvedValueOnce(tokenResponse("x", "2026-07-19T12:00:00Z"));

    await issuer.issueToken("o/r");

    const [tokenUrl] = fetchSpy.mock.calls[1];
    expect(tokenUrl).toBe("https://api.github.com/app/installations/99/access_tokens");
  });

  it("throws RepositoryNotGrantedError when GitHub returns 404 (no installation covers the repo)", async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 404,
      ok: false,
      json: async () => ({}),
      text: async () => "Not Found",
    });

    await expect(issuer.issueToken("o/r")).rejects.toThrow(RepositoryNotGrantedError);
  });

  it("throws a generic error when the installation endpoint returns a non-404 failure", async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 500,
      ok: false,
      json: async () => ({}),
      text: async () => "Internal Server Error",
    });

    await expect(issuer.issueToken("o/r")).rejects.toThrow(/GitHub App.*500/);
  });

  it("throws a generic error when the token-minting endpoint fails", async () => {
    fetchSpy.mockResolvedValueOnce(installationResponse(1)).mockResolvedValueOnce({
      status: 403,
      ok: false,
      json: async () => ({}),
      text: async () => "Forbidden",
    });

    await expect(issuer.issueToken("o/r")).rejects.toThrow(/GitHub App.*403/);
  });

  it("throws RepositoryNotGrantedError when the token-minting endpoint returns 422 (repo not accessible/selected)", async () => {
    fetchSpy.mockResolvedValueOnce(installationResponse(1)).mockResolvedValueOnce({
      status: 422,
      ok: false,
      json: async () => ({}),
      text: async () => "Validation Failed",
    });

    await expect(issuer.issueToken("o/r")).rejects.toThrow(RepositoryNotGrantedError);
  });
});

describe("createGitHubAppTokenIssuer.listInstallations", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let issuer: ReturnType<typeof createGitHubAppTokenIssuer>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    issuer = createGitHubAppTokenIssuer(VALID_CONFIG);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function installationsResponse(
    installations: Array<{
      id: number;
      account: { login: string; avatar_url: string; type: "User" | "Organization" };
      repository_selection: "all" | "selected";
      html_url: string;
    }>,
  ) {
    return {
      status: 200,
      ok: true,
      json: async () => installations,
      text: async () => "",
    };
  }

  it("lists installations with their metadata", async () => {
    fetchSpy.mockResolvedValueOnce(
      installationsResponse([
        {
          id: 42,
          account: { login: "alice", avatar_url: "https://a.com/avatar.png", type: "User" },
          repository_selection: "all",
          html_url: "https://github.com/apps/my-app/installations/42",
        },
      ]),
    );

    const installations = await issuer.listInstallations();

    expect(installations).toHaveLength(1);
    expect(installations[0]).toMatchObject({
      id: 42,
      account: { login: "alice", avatarUrl: "https://a.com/avatar.png", type: "User" },
      repositorySelection: "all",
      htmlUrl: "https://github.com/apps/my-app/installations/42",
      repositories: [],
    });
  });

  it("calls the installations endpoint with a JWT", async () => {
    fetchSpy.mockResolvedValueOnce(installationsResponse([]));

    await issuer.listInstallations();

    expect(fetchSpy).toHaveBeenCalled();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.github.com/app/installations");
    expect(opts.headers.Authorization).toMatch(/^Bearer /);
    expect(opts.headers.Accept).toBe("application/vnd.github+json");
  });

  it("fetches repositories when repository_selection is 'selected'", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        installationsResponse([
          {
            id: 7,
            account: { login: "o", avatar_url: "", type: "Organization" },
            repository_selection: "selected",
            html_url: "https://github.com/apps/my-app/installations/7",
          },
        ]),
      )
      // mint installation token
      .mockResolvedValueOnce({
        status: 201,
        ok: true,
        json: async () => ({ token: "inst-token" }),
        text: async () => "",
      })
      // list repositories
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          repositories: [{ full_name: "o/r1" }, { full_name: "o/r2" }],
        }),
        text: async () => "",
      });

    const installations = await issuer.listInstallations();

    expect(installations[0].repositories).toEqual(["o/r1", "o/r2"]);
  });

  it("returns an empty repository list when the token-minting step fails for a selected installation", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        installationsResponse([
          {
            id: 7,
            account: { login: "o", avatar_url: "", type: "Organization" },
            repository_selection: "selected",
            html_url: "",
          },
        ]),
      )
      .mockResolvedValueOnce({
        status: 500,
        ok: false,
        json: async () => ({}),
        text: async () => "",
      });

    const installations = await issuer.listInstallations();

    expect(installations[0].repositories).toEqual([]);
  });

  it("returns an empty repository list when the repository-listing step fails", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        installationsResponse([
          {
            id: 7,
            account: { login: "o", avatar_url: "", type: "Organization" },
            repository_selection: "selected",
            html_url: "",
          },
        ]),
      )
      .mockResolvedValueOnce({
        status: 201,
        ok: true,
        json: async () => ({ token: "inst-token" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        status: 500,
        ok: false,
        json: async () => ({}),
        text: async () => "",
      });

    const installations = await issuer.listInstallations();

    expect(installations[0].repositories).toEqual([]);
  });

  it("returns an empty list when there are no installations", async () => {
    fetchSpy.mockResolvedValueOnce(installationsResponse([]));

    const installations = await issuer.listInstallations();

    expect(installations).toEqual([]);
  });

  it("throws when the installations endpoint fails", async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 500,
      ok: false,
      json: async () => ({}),
      text: async () => "Internal Server Error",
    });

    await expect(issuer.listInstallations()).rejects.toThrow(/GitHub App.*500/);
  });
});
