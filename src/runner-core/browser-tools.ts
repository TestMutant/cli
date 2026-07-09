import type { Locator, Page } from "playwright";

export function resolveLocator(page: Page, locator: string): Locator {
  const trimmed = locator.trim();

  const role = trimmed.match(/^getByRole\((['"])([^'"]+)\1,\s*\{\s*name:\s*(['"])(.*?)\3\s*\}\)$/);
  if (role) {
    return page.getByRole(role[2] as never, { name: unescapeLocatorText(role[4] ?? "") });
  }

  const label = trimmed.match(/^getByLabel\((['"])(.*?)\1\)$/);
  if (label) {
    return page.getByLabel(unescapeLocatorText(label[2] ?? ""));
  }

  const placeholder = trimmed.match(/^getByPlaceholder\((['"])(.*?)\1\)$/);
  if (placeholder) {
    return page.getByPlaceholder(unescapeLocatorText(placeholder[2] ?? ""));
  }

  const locatorCall = trimmed.match(/^locator\((['"])(.*?)\1\)$/);
  if (locatorCall) {
    return page.locator(unescapeLocatorText(locatorCall[2] ?? ""));
  }

  return page.locator(trimmed);
}

export function locatorCall(kind: "getByRole" | "getByLabel" | "getByPlaceholder" | "locator", value: string, role?: string): string {
  if (kind === "getByRole") {
    return `getByRole(${quote(role ?? "button")}, { name: ${quote(value)} })`;
  }

  if (kind === "getByLabel") {
    return `getByLabel(${quote(value)})`;
  }

  if (kind === "getByPlaceholder") {
    return `getByPlaceholder(${quote(value)})`;
  }

  return `locator(${quote(value)})`;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function unescapeLocatorText(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value;
  }
}
