import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/backend/client", () => ({ supabase: () => null }));

const URL_ = "https://fakeproj.supabase.co";
const ANON = "anon-key-that-is-long-enough-123";
const complaint = { anonymous: true, category: "public_conduct", summary: "Rude at a traffic stop", description: "x".repeat(60), incidentDate: null, incidentTime: null, location: null, officerId: null, officerDescription: "Unit 3 driver", witnesses: null, links: [], name: null, discord: null, contact: null, roblox: null };

async function load() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON);
  return import("@/lib/ia/client");
}

describe("complaint intake client", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses to submit when no backend is configured", async () => {
    vi.resetModules();
    const { submitComplaint } = await import("@/lib/ia/client");
    const r = await submitComplaint(complaint as never, []);
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts JSON with only the public anon key and returns the receipt", async () => {
    const { submitComplaint } = await load();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ reference: "TPD-ABCD-EFGH", token: "t".repeat(43), files: { received: 0, stored: 0 } }), { status: 201 }));
    const r = await submitComplaint(complaint as never, []);
    expect(r).toEqual({ ok: true, reference: "TPD-ABCD-EFGH", token: "t".repeat(43), files: { received: 0, stored: 0 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL_}/functions/v1/ia-intake`);
    expect(init.headers.authorization).toBe(`Bearer ${ANON}`);
    expect(JSON.parse(init.body)).toMatchObject({ action: "submit", anonymous: true });
  });

  it("sends files as multipart and surfaces server field errors", async () => {
    const { submitComplaint } = await load();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Check the highlighted fields.", fields: { summary: "Too short" } }), { status: 400 }));
    const r = await submitComplaint(complaint as never, [new File(["x"], "a.png", { type: "image/png" })]);
    expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData);
    expect(r).toEqual({ ok: false, status: 400, message: "Check the highlighted fields.", fields: { summary: "Too short" } });
  });

  it("says nothing was saved when the network fails", async () => {
    const { submitComplaint } = await load();
    fetchMock.mockRejectedValue(new TypeError("offline"));
    expect(await submitComplaint(complaint as never, [])).toMatchObject({ ok: false, status: 0, message: expect.stringMatching(/Nothing was saved/) });
  });

  it("looks up a receipt with reference and token", async () => {
    const { checkReceipt } = await load();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ found: false }), { status: 200 }));
    expect(await checkReceipt("TPD-ABCD-EFGH", "t".repeat(43))).toEqual({ found: false });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "status", reference: "TPD-ABCD-EFGH", token: "t".repeat(43) });
  });
});
