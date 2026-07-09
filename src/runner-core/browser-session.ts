import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { ensurePlaywrightBrowserInstalled } from "../playwright-install";
import { writeArtifact } from "./artifacts";
import { buildBrowserSnapshot } from "./browser-snapshot";
import { resolveLocator } from "./browser-tools";
import { safeErrorMessage, redactSensitiveText, redactUrl } from "./redaction";
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
    return await buildBrowserSnapshot(this.requirePage(), request, {
      artifactDirectory: this.options.artifactDirectory,
      consoleErrors: this.getConsoleEntries().filter((entry) =>
        ["error", "pageerror"].includes(entry.level),
      ),
      networkErrors: this.getNetworkEntries(),
    });
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

  async validateDraft(
    request: ValidateDraftPlaywrightTestRequest,
  ): Promise<ValidateDraftPlaywrightTestResponse> {
    return await validateDraftPlaywrightTest(request, {
      artifactDirectory: request.artifactDirectory ?? this.options.artifactDirectory,
    });
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
        message: redactSensitiveText(message.text()),
        timestampUtc: new Date().toISOString(),
      });
    });

    page.on("pageerror", (error) => {
      pushRing(this.consoleEntries, {
        level: "pageerror",
        message: safeErrorMessage(error),
        timestampUtc: new Date().toISOString(),
      });
    });

    page.on("requestfailed", (request) => {
      pushRing(this.networkEntries, {
        url: redactUrl(request.url()),
        method: request.method(),
        status: null,
        failureText: redactSensitiveText(request.failure()?.errorText ?? "request failed"),
        timestampUtc: new Date().toISOString(),
      });
    });

    page.on("response", (response) => {
      if (response.status() < 400) {
        return;
      }
      pushRing(this.networkEntries, {
        url: redactUrl(response.url()),
        method: response.request().method(),
        status: response.status(),
        failureText: null,
        timestampUtc: new Date().toISOString(),
      });
    });
  }
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
