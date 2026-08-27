import type { DiaryAuthor } from "./types.ts";

export const DEMO_PASSWORDS = {
  person1: "demo-a",
  person2: "demo-b",
} as const;

export function demoIdentityForPassword(password: string): DiaryAuthor | null {
  if (password === DEMO_PASSWORDS.person1) return "person1";
  if (password === DEMO_PASSWORDS.person2) return "person2";
  return null;
}

export function demoSessionToken(identity: DiaryAuthor): string {
  return `demo:${identity}`;
}

export function demoIdentityFromSession(token: string | null): DiaryAuthor | null {
  if (token === "demo:person1") return "person1";
  if (token === "demo:person2") return "person2";
  return null;
}
