import type { Page } from "playwright";
import { writeArtifact } from "./artifacts";
import {
  DEFAULT_MAX_CONSOLE_ERRORS,
  DEFAULT_MAX_ELEMENTS,
  DEFAULT_MAX_NETWORK_ERRORS,
  DEFAULT_MAX_TEXT_LENGTH,
  positiveInt,
} from "./limits";
import { locatorCall } from "./browser-tools";
import { isSensitiveField } from "./redaction";
import type {
  BrowserFormElement,
  BrowserInputElement,
  BrowserInteractiveElement,
  BrowserSnapshotRequest,
  BrowserSnapshotResponse,
  BrowserTextElement,
  RunnerArtifactReference,
  RunnerCandidateLocator,
  RunnerLogEntry,
  RunnerNetworkEntry,
} from "./runner-contracts";

export type BuildSnapshotOptions = {
  artifactDirectory: string;
  consoleErrors: RunnerLogEntry[];
  networkErrors: RunnerNetworkEntry[];
};

type RawSnapshot = {
  title: string;
  visibleText: string;
  headings: BrowserTextElement[];
  buttons: BrowserInteractiveElement[];
  links: BrowserInteractiveElement[];
  inputs: BrowserInputElement[];
  forms: BrowserFormElement[];
  candidateLocators: RunnerCandidateLocator[];
};

export async function buildBrowserSnapshot(
  page: Page,
  request: BrowserSnapshotRequest,
  options: BuildSnapshotOptions,
): Promise<BrowserSnapshotResponse> {
  const maxTextLength = positiveInt(request.maxTextLength, DEFAULT_MAX_TEXT_LENGTH);
  const maxElements = positiveInt(request.maxElements, DEFAULT_MAX_ELEMENTS);
  const raw = await page.evaluate(extractSnapshot, { maxElements });
  const visibleTextPreview =
    raw.visibleText.length > maxTextLength
      ? raw.visibleText.slice(0, maxTextLength)
      : raw.visibleText;
  const screenshot = request.includeScreenshot
    ? await captureSnapshotScreenshot(page, options.artifactDirectory)
    : null;

  return {
    url: page.url(),
    title: raw.title || null,
    visibleTextPreview,
    headings: raw.headings,
    buttons: raw.buttons,
    links: raw.links,
    inputs: raw.inputs,
    forms: raw.forms,
    candidateLocators: raw.candidateLocators,
    consoleErrors: options.consoleErrors.slice(-DEFAULT_MAX_CONSOLE_ERRORS),
    networkErrors: options.networkErrors.slice(-DEFAULT_MAX_NETWORK_ERRORS),
    screenshot,
    truncated: raw.visibleText.length > maxTextLength ||
      raw.headings.length >= maxElements ||
      raw.buttons.length >= maxElements ||
      raw.links.length >= maxElements ||
      raw.inputs.length >= maxElements,
  };
}

async function captureSnapshotScreenshot(
  page: Page,
  artifactDirectory: string,
): Promise<RunnerArtifactReference | null> {
  try {
    const data = await page.screenshot({ fullPage: false, animations: "disabled" });
    return await writeArtifact(
      artifactDirectory,
      "screenshot",
      `snapshot-${Date.now()}.png`,
      "image/png",
      data,
    );
  } catch {
    return null;
  }
}

function extractSnapshot(args: { maxElements: number }): RawSnapshot {
  const locatorCall = (kind: "getByRole" | "getByLabel" | "getByPlaceholder" | "locator", value: string, role?: string): string => {
    if (kind === "getByRole") {
      return `getByRole(${JSON.stringify(role ?? "button")}, { name: ${JSON.stringify(value)} })`;
    }
    if (kind === "getByLabel") {
      return `getByLabel(${JSON.stringify(value)})`;
    }
    if (kind === "getByPlaceholder") {
      return `getByPlaceholder(${JSON.stringify(value)})`;
    }
    return `locator(${JSON.stringify(value)})`;
  };
  const sensitive = (value: string | null | undefined): boolean =>
    Boolean(value && /(token|secret|password|passwd|api[_-]?key|session|cookie|authorization|localStorage|sessionStorage)/i.test(value));
  const isSensitiveField = (input: {
    type?: string | null;
    name?: string | null;
    label?: string | null;
    placeholder?: string | null;
    selector?: string | null;
  }): boolean => [
    input.type,
    input.name,
    input.label,
    input.placeholder,
    input.selector,
  ].some(sensitive);
  const cleanText = (value: string | null | undefined): string =>
    (value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  const attr = (element: Element, name: string): string | null => {
    const value = element.getAttribute(name)?.trim();
    return value || null;
  };
  const cssEscape = (value: string): string =>
    value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const isVisible = (element: Element): boolean => {
    const html = element as HTMLElement;
    const style = window.getComputedStyle(html);
    const rect = html.getBoundingClientRect();
    return style.visibility !== "hidden" &&
      style.display !== "none" &&
      rect.width > 0 &&
      rect.height > 0;
  };
  const visibleElements = (selector: string): Element[] =>
    Array.from(document.querySelectorAll(selector)).filter(isVisible);
  const findLabel = (element: Element): string | null => {
    const aria = attr(element, "aria-label");
    if (aria) {
      return aria;
    }
    const id = attr(element, "id");
    if (id) {
      const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
      const text = cleanText(label?.textContent);
      if (text) {
        return text;
      }
    }
    const wrapped = element.closest("label");
    return cleanText(wrapped?.textContent) || null;
  };
  const stableSelector = (element: Element): string | null => {
    const testId = attr(element, "data-testid") ?? attr(element, "data-test");
    if (testId) {
      return `[data-testid="${cssEscape(testId)}"]`;
    }
    const id = attr(element, "id");
    if (id && /^[A-Za-z][A-Za-z0-9_-]{1,80}$/.test(id)) {
      return `#${cssEscape(id)}`;
    }
    const name = attr(element, "name");
    if (name) {
      return `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
    }
    return null;
  };
  const interactiveElement = (
    element: Element,
    role: "button" | "link",
    candidates: RunnerCandidateLocator[],
  ): BrowserInteractiveElement => {
    const text = cleanText(
      element.textContent ||
        attr(element, "value") ||
        attr(element, "aria-label") ||
        attr(element, "title") ||
        "",
    ) || null;
    const selector = stableSelector(element);
    const candidateLocator = text
      ? locatorCall("getByRole", text, role)
      : selector
        ? locatorCall("locator", selector)
        : null;
    if (candidateLocator) {
      candidates.push({
        kind: text ? "role" : "selector",
        value: candidateLocator,
        confidence: text ? "high" : "medium",
      });
    }
    return {
      text,
      role,
      selector,
      candidateLocator,
      disabled: (element as HTMLButtonElement).disabled === true,
    };
  };
  const inputElement = (
    element: Element,
    candidates: RunnerCandidateLocator[],
  ): BrowserInputElement => {
    const type = attr(element, "type") ?? element.tagName.toLowerCase();
    const name = attr(element, "name");
    const placeholder = attr(element, "placeholder");
    const label = findLabel(element);
    const selector = stableSelector(element);
    const candidateLocator = label
      ? locatorCall("getByLabel", label)
      : placeholder
        ? locatorCall("getByPlaceholder", placeholder)
        : name
          ? locatorCall("locator", `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`)
          : selector
            ? locatorCall("locator", selector)
            : null;
    if (candidateLocator) {
      candidates.push({
        kind: label ? "label" : placeholder ? "placeholder" : "selector",
        value: candidateLocator,
        confidence: label || placeholder ? "high" : "medium",
      });
    }
    return {
      label,
      placeholder,
      name,
      type,
      selector,
      candidateLocator,
      valueRedacted: isSensitiveField({ type, name, label, placeholder, selector }),
    };
  };
  const dedupeCandidates = (values: RunnerCandidateLocator[]): RunnerCandidateLocator[] => {
    const seen = new Set<string>();
    return values.filter((value) => {
      if (seen.has(value.value)) {
        return false;
      }
      seen.add(value.value);
      return true;
    });
  };
  const maxElements = args.maxElements;
  const candidateLocators: RunnerCandidateLocator[] = [];

  const headings = visibleElements("h1,h2,h3,h4,h5,h6")
    .slice(0, maxElements)
    .map((element) => {
      const text = cleanText(element.textContent);
      const level = Number(element.tagName.slice(1));
      const candidateLocator = text ? locatorCall("getByRole", text, "heading") : null;
      if (candidateLocator) {
        candidateLocators.push({ kind: "role", value: candidateLocator, confidence: "medium" });
      }
      return { text, level, candidateLocator };
    })
    .filter((element) => element.text);

  const buttons = visibleElements("button,[role='button'],input[type='button'],input[type='submit']")
    .slice(0, maxElements)
    .map((element) => interactiveElement(element, "button", candidateLocators));

  const links = visibleElements("a[href]")
    .slice(0, maxElements)
    .map((element) => interactiveElement(element, "link", candidateLocators));

  const inputs = visibleElements("input,textarea,select")
    .slice(0, maxElements)
    .map((element) => inputElement(element, candidateLocators));

  const forms = visibleElements("form")
    .slice(0, Math.min(10, maxElements))
    .map((form) => {
      const formInputs = Array.from(form.querySelectorAll("input,textarea,select"))
        .filter(isVisible)
        .slice(0, maxElements)
        .map((element) => inputElement(element, candidateLocators));
      const submitButtons = Array.from(form.querySelectorAll("button,input[type='submit']"))
        .filter(isVisible)
        .slice(0, maxElements)
        .map((element) => interactiveElement(element, "button", candidateLocators));

      return {
        name: attr(form, "name"),
        action: attr(form, "action"),
        method: attr(form, "method"),
        inputs: formInputs,
        submitButtons,
      };
    });

  return {
    title: document.title,
    visibleText: cleanText(document.body?.innerText ?? ""),
    headings,
    buttons,
    links,
    inputs,
    forms,
    candidateLocators: dedupeCandidates(candidateLocators).slice(0, maxElements),
  };
}

function interactiveElement(
  element: Element,
  role: "button" | "link",
  candidates: RunnerCandidateLocator[],
): BrowserInteractiveElement {
  const text = cleanText(
    element.textContent ||
      attr(element, "value") ||
      attr(element, "aria-label") ||
      attr(element, "title") ||
      "",
  ) || null;
  const selector = stableSelector(element);
  const candidateLocator = text
    ? locatorCall("getByRole", text, role)
    : selector
      ? locatorCall("locator", selector)
      : null;

  if (candidateLocator) {
    candidates.push({
      kind: text ? "role" : "selector",
      value: candidateLocator,
      confidence: text ? "high" : "medium",
    });
  }

  return {
    text,
    role,
    selector,
    candidateLocator,
    disabled: (element as HTMLButtonElement).disabled === true,
  };
}

function inputElement(
  element: Element,
  candidates: RunnerCandidateLocator[],
): BrowserInputElement {
  const type = attr(element, "type") ?? element.tagName.toLowerCase();
  const name = attr(element, "name");
  const placeholder = attr(element, "placeholder");
  const label = findLabel(element);
  const selector = stableSelector(element);
  const candidateLocator = label
    ? locatorCall("getByLabel", label)
    : placeholder
      ? locatorCall("getByPlaceholder", placeholder)
      : name
        ? locatorCall("locator", `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`)
        : selector
          ? locatorCall("locator", selector)
          : null;

  if (candidateLocator) {
    candidates.push({
      kind: label ? "label" : placeholder ? "placeholder" : "selector",
      value: candidateLocator,
      confidence: label || placeholder ? "high" : "medium",
    });
  }

  return {
    label,
    placeholder,
    name,
    type,
    selector,
    candidateLocator,
    valueRedacted: isSensitiveField({ type, name, label, placeholder, selector }),
  };
}

function visibleElements(selector: string): Element[] {
  return Array.from(document.querySelectorAll(selector)).filter(isVisible);
}

function isVisible(element: Element): boolean {
  const html = element as HTMLElement;
  const style = window.getComputedStyle(html);
  const rect = html.getBoundingClientRect();
  return style.visibility !== "hidden" &&
    style.display !== "none" &&
    rect.width > 0 &&
    rect.height > 0;
}

function findLabel(element: Element): string | null {
  const aria = attr(element, "aria-label");
  if (aria) {
    return aria;
  }

  const id = attr(element, "id");
  if (id) {
    const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
    const text = cleanText(label?.textContent);
    if (text) {
      return text;
    }
  }

  const wrapped = element.closest("label");
  return cleanText(wrapped?.textContent) || null;
}

function stableSelector(element: Element): string | null {
  const testId = attr(element, "data-testid") ?? attr(element, "data-test");
  if (testId) {
    return `[data-testid="${cssEscape(testId)}"]`;
  }

  const id = attr(element, "id");
  if (id && /^[A-Za-z][A-Za-z0-9_-]{1,80}$/.test(id)) {
    return `#${cssEscape(id)}`;
  }

  const name = attr(element, "name");
  if (name) {
    return `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
  }

  return null;
}

function attr(element: Element, name: string): string | null {
  const value = element.getAttribute(name)?.trim();
  return value || null;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function dedupeCandidates(values: RunnerCandidateLocator[]): RunnerCandidateLocator[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.value)) {
      return false;
    }
    seen.add(value.value);
    return true;
  });
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
