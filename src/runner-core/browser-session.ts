import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensurePlaywrightBrowserInstalled } from "../playwright-install";
import { writeArtifact } from "./artifacts";
import { buildBrowserSnapshot } from "./browser-snapshot";
import { resolveLocator } from "./browser-tools";
import { safeErrorMessage, redactSensitiveText, redactUrl } from "./redaction";
import { prepareRunnerSession } from "./session-auth";
import type {
  BrowserSnapshotRequest,
  BrowserSnapshotResponse,
  CheckRequest,
  ClickRequest,
  FillRequest,
  NavigateRequest,
  NavigateResponse,
  PressRequest,
  RunnerArtifactReference,
  RunnerLogEntry,
  RunnerNetworkEntry,
  RunnerSessionPreparationResponse,
  ScreenshotRequest,
  SelectRequest,
  ValidateDraftPlaywrightTestRequest,
  ValidateDraftPlaywrightTestResponse,
} from "./runner-contracts";
import { validateDraftPlaywrightTest } from "./playwright-runner-adapter";

const MAX_RING_ENTRIES = 100;

export type BrowserSessionOptions = {
  sessionId: string;
  baseUrl: string | null;
  artifactDirectory: string;
  headless: boolean;
  timeoutMs: number;
};

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly consoleEntries: RunnerLogEntry[] = [];
  private readonly networkEntries: RunnerNetworkEntry[] = [];

  private constructor(private readonly options: BrowserSessionOptions) {}

  static async create(options: BrowserSessionOptions): Promise<BrowserSession> {
    await ensurePlaywrightBrowserInstalled();
    const session = new BrowserSession(options);
    session.browser = await chromium.launch({ headless: options.headless });
    session.context = await session.browser.newContext({
      baseURL: options.baseUrl ?? undefined,
    });
    await session.configureOriginGuard();
    session.page = await session.context.newPage();
    session.attachPageEvents(session.page);
    return session;
  }

  async navigate(request: NavigateRequest): Promise<NavigateResponse> {
    const page = this.requirePage();
    await page.goto(request.url, {
      waitUntil: normalizeWaitUntil(request.waitUntil),
      timeout: timeout(request.timeoutMs, this.options.timeoutMs),
    });

    return {
      url: page.url(),
      title: await page.title().catch(() => null),
      snapshot: await this.snapshot({
        includeScreenshot: false,
        maxTextLength: null,
        maxElements: null,
      }),
    };
  }

  async snapshot(request: BrowserSnapshotRequest): Promise<BrowserSnapshotResponse> {
    const snapshot = await buildBrowserSnapshot(this.requirePage(), request, {
      artifactDirectory: this.options.artifactDirectory,
      consoleErrors: this.getConsoleEntries().filter((entry) =>
        ["error", "pageerror"].includes(entry.level),
      ),
      networkErrors: this.getNetworkEntries(),
    });
    return redactSnapshot(snapshot, this.explicitSecrets());
  }

  async click(request: ClickRequest): Promise<BrowserSnapshotResponse> {
    await resolveLocator(this.requirePage(), request.locator).click({
      timeout: timeout(request.timeoutMs, this.options.timeoutMs),
    });
    return this.snapshot(defaultSnapshotRequest());
  }

  async fill(request: FillRequest): Promise<BrowserSnapshotResponse> {
    await resolveLocator(this.requirePage(), request.locator).fill(request.value, {
      timeout: timeout(request.timeoutMs, this.options.timeoutMs),
    });
    return this.snapshot(defaultSnapshotRequest());
  }

  async press(request: PressRequest): Promise<BrowserSnapshotResponse> {
    const page = this.requirePage();
    if (request.locator) {
      await resolveLocator(page, request.locator).press(request.key, {
        timeout: timeout(request.timeoutMs, this.options.timeoutMs),
      });
    } else {
      await page.keyboard.press(request.key);
    }
    return this.snapshot(defaultSnapshotRequest());
  }

  async select(request: SelectRequest): Promise<BrowserSnapshotResponse> {
    await resolveLocator(this.requirePage(), request.locator).selectOption(request.value, {
      timeout: timeout(request.timeoutMs, this.options.timeoutMs),
    });
    return this.snapshot(defaultSnapshotRequest());
  }

  async check(request: CheckRequest): Promise<BrowserSnapshotResponse> {
    const locator = resolveLocator(this.requirePage(), request.locator);
    if (request.checked) {
      await locator.check({ timeout: timeout(request.timeoutMs, this.options.timeoutMs) });
    } else {
      await locator.uncheck({ timeout: timeout(request.timeoutMs, this.options.timeoutMs) });
    }
    return this.snapshot(defaultSnapshotRequest());
  }

  async screenshot(request: ScreenshotRequest): Promise<RunnerArtifactReference> {
    const data = await this.requirePage().screenshot({
      fullPage: request.fullPage,
      animations: "disabled",
      mask: [this.requirePage().locator(SENSITIVE_SCREENSHOT_SELECTOR)],
    });
    return await writeArtifact(
      this.options.artifactDirectory,
      "screenshot",
      request.fileName ?? `screenshot-${Date.now()}.png`,
      "image/png",
      data,
    );
  }

  getConsoleEntries(): RunnerLogEntry[] {
    return [...this.consoleEntries];
  }

  getNetworkEntries(): RunnerNetworkEntry[] {
    return [...this.networkEntries];
  }

  async prepare(): Promise<RunnerSessionPreparationResponse> {
    return await prepareRunnerSession(
      this.requirePage(),
      this.options.environment,
      this.options.timeoutMs,
    );
  }

  async validateDraft(
    request: ValidateDraftPlaywrightTestRequest,
  ): Promise<ValidateDraftPlaywrightTestResponse> {
    const context = this.context;
    if (!context) {
      throw new Error("Browser session is closed.");
    }
    const stateDirectory = await mkdtemp(join(tmpdir(), "testmutant-session-state-"));
    const storageStatePath = join(stateDirectory, "storage-state.json");
    try {
      await context.storageState({ path: storageStatePath });
      return await validateDraftPlaywrightTest(request, {
        artifactDirectory: request.artifactDirectory ?? this.options.artifactDirectory,
        storageStatePath,
        explicitSecrets: this.explicitSecrets(),
      });
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.context = null;
    this.browser = null;
    this.page = null;
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new Error("Browser session is closed.");
    }

    return this.page;
  }

  private attachPageEvents(page: Page): void {
    page.on("console", (message) => {
      pushRing(this.consoleEntries, {
        level: message.type(),
        message: redactSensitiveText(message.text(), this.explicitSecrets()),
        timestampUtc: new Date().toISOString(),
      });
    });

    page.on("pageerror", (error) => {
      pushRing(this.consoleEntries, {
        level: "pageerror",
        message: safeErrorMessage(error, this.explicitSecrets()),
        timestampUtc: new Date().toISOString(),
      });
    });

    page.on("requestfailed", (request) => {
      pushRing(this.networkEntries, {
        url: redactSensitiveText(redactUrl(request.url()), this.explicitSecrets()),
        method: request.method(),
        status: null,
        failureText: redactSensitiveText(request.failure()?.errorText ?? "request failed", this.explicitSecrets()),
        timestampUtc: new Date().toISOString(),
      });
    });

    page.on("response", (response) => {
      if (response.status() < 400) {
        return;
      }
      pushRing(this.networkEntries, {
        url: redactSensitiveText(redactUrl(response.url()), this.explicitSecrets()),
        method: response.request().method(),
        status: response.status(),
        failureText: null,
        timestampUtc: new Date().toISOString(),
      });
    });
  }

  private explicitSecrets(): string[] {
    return [
      this.options.environment?.username ?? "",
      this.options.environment?.password ?? "",
    ].filter(Boolean);
  }

  private async configureOriginGuard(): Promise<void> {
    const context = this.context;
    if (!context) {
      return;
    }
    const allowedOrigins = [this.options.baseUrl, this.options.environment?.loginUrl]
      .flatMap((value) => {
        try {
          return value ? [new URL(value).origin] : [];
        } catch {
          return [];
        }
      });
    if (allowedOrigins.length === 0) {
      return;
    }
    await context.route("**/*", async (route) => {
      try {
        const origin = new URL(route.request().url()).origin;
        if (allowedOrigins.includes(origin)) {
          await route.continue();
          return;
        }
      } catch {
      }
      await route.abort("blockedbyclient");
    });
  }
}

const SENSITIVE_SCREENSHOT_SELECTOR = [
  "input[type='password']",
  "input[name*='password' i]",
  "input[name*='token' i]",
  "input[name*='secret' i]",
  "textarea[name*='secret' i]",
].join(", ");

function redactSnapshot(snapshot: BrowserSnapshotResponse, secrets: string[]): BrowserSnapshotResponse {
  const redact = (value: string | null): string | null => value === null ? null : redactSensitiveText(value, secrets);
  return {
    ...snapshot,
    url: redactSensitiveText(snapshot.url, secrets),
    title: redact(snapshot.title),
    visibleTextPreview: redact(snapshot.visibleTextPreview),
    headings: snapshot.headings.map((item) => ({ ...item, text: redactSensitiveText(item.text, secrets) })),
    buttons: snapshot.buttons.map((item) => ({ ...item, text: redact(item.text) })),
    links: snapshot.links.map((item) => ({ ...item, text: redact(item.text) })),
    consoleErrors: snapshot.consoleErrors.map((item) => ({ ...item, message: redactSensitiveText(item.message, secrets) })),
    networkErrors: snapshot.networkErrors.map((item) => ({
      ...item,
      url: redactSensitiveText(item.url, secrets),
      failureText: redact(item.failureText),
    })),
  };
}

function pushRing<T>(entries: T[], entry: T): void {
  entries.push(entry);
  if (entries.length > MAX_RING_ENTRIES) {
    entries.splice(0, entries.length - MAX_RING_ENTRIES);
  }
}

function timeout(value: number | string | null | undefined, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeWaitUntil(value: string | null | undefined): "load" | "domcontentloaded" | "networkidle" | "commit" {
  if (value === "load" || value === "networkidle" || value === "commit") {
    return value;
  }
  return "domcontentloaded";
}

function defaultSnapshotRequest(): BrowserSnapshotRequest {
  return {
    includeScreenshot: false,
    maxTextLength: null,
    maxElements: null,
  };
}
