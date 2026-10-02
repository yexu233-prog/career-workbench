import type { OnboardingState } from "@career-workbench/database";

export const isOnboardingPath = (pathname: string): boolean => pathname === "/welcome" || pathname === "/tutorial";

export function getOnboardingRedirect(
  pathname: string,
  status: OnboardingState["status"],
  bypass = false
): string | undefined {
  if (bypass) return undefined;
  if (status !== "completed" && !isOnboardingPath(pathname)) return "/welcome";
  if (status === "completed" && pathname === "/welcome") return "/profile";
  return undefined;
}
