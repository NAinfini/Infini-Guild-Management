import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockJsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

import {
  updateMyProfile,
  changeMyPassword,
  changeMyUsername,
  deleteProfileImage,
  deleteProfileImages,
  deleteProfileAudio,
} from "../UserService";

describe("UserService mutations", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("updateMyProfile sends PATCH with validated payload", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ id: "u-1" }));
    await updateMyProfile("u-1", { classes: ["鸣金虹"], power: 5000 });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/users/u-1/profile");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body);
    expect(body.classes).toEqual(["鸣金虹"]);
    expect(body.power).toBe(5000);
  });

  it("changeMyPassword sends POST with current and new password", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    await changeMyPassword("u-1", {
      currentPassword: "oldPass123",
      newPassword: "newPass456!",
      confirmNewPassword: "newPass456!",
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/users/u-1/change-password");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.currentPassword).toBe("oldPass123");
    expect(body.newPassword).toBe("newPass456!");
  });

  it("changeMyPassword rejects mismatched passwords", () => {
    expect(() =>
      changeMyPassword("u-1", {
        currentPassword: "oldPass123",
        newPassword: "newPass456!",
        confirmNewPassword: "different!",
      }),
    ).toThrow();
  });

  it("changeMyUsername sends POST with new username", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    await changeMyUsername("u-1", {
      currentPassword: "myPassword",
      newUsername: "updated_name",
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/users/u-1/change-username");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.newUsername).toBe("updated_name");
  });

  it("changeMyUsername rejects empty username", () => {
    expect(() =>
      changeMyUsername("u-1", {
        currentPassword: "myPassword",
        newUsername: "",
      }),
    ).toThrow();
  });

  it("deleteProfileImage sends one-key delete request", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true, deleted: 1 }));
    await deleteProfileImage("u-1", "users/u-1/images/photo.webp");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/users/u-1/media/images");
    expect(url).not.toContain("batch");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body)).toEqual({
      keys: ["users/u-1/images/photo.webp"],
    });
  });

  it("deleteProfileImages sends one delete request", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true, deleted: 2 }));
    await deleteProfileImages("u-1", ["users/u-1/images/one.webp", "users/u-1/images/two.webp"]);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/users/u-1/media/images");
    expect(url).not.toContain("batch");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body)).toEqual({
      keys: ["users/u-1/images/one.webp", "users/u-1/images/two.webp"],
    });
  });

  it("deleteProfileAudio sends DELETE to audio endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    await deleteProfileAudio("u-1");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/users/u-1/media/audio");
    expect(init.method).toBe("DELETE");
  });
});
