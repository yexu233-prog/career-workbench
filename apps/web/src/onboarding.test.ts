import { describe, expect, it } from "vitest";
import { getOnboardingRedirect, isOnboardingPath } from "./onboarding";

describe("onboarding route rules", () => {
  it("sends a first-time user to the welcome page", () => {
    expect(getOnboardingRedirect("/", "new")).toBe("/welcome");
    expect(getOnboardingRedirect("/profile", "started")).toBe("/welcome");
  });

  it("keeps welcome and tutorial routes available while onboarding is unfinished", () => {
    expect(getOnboardingRedirect("/welcome", "new")).toBeUndefined();
    expect(getOnboardingRedirect("/tutorial", "started")).toBeUndefined();
    expect(isOnboardingPath("/tutorial")).toBe(true);
  });

  it("does not show the welcome page again after completion", () => {
    expect(getOnboardingRedirect("/welcome", "completed")).toBe("/profile");
    expect(getOnboardingRedirect("/profile", "completed")).toBeUndefined();
    expect(getOnboardingRedirect("/tutorial", "completed")).toBeUndefined();
  });

  it("allows the user to enter the workbench when onboarding state cannot be read", () => {
    expect(getOnboardingRedirect("/profile", "new", true)).toBeUndefined();
  });
});
