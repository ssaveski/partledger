import { createHmac } from 'node:crypto';

import { commandPath, idempotencyKeyHeader, staffAuthPaths, staffRequestHeader } from '@partledger/contracts';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { z } from 'zod';

import { sessionCookieName } from '../../src/auth/session-cookie';
import { formOn, linkOn, TestBrowser, type SyntheticUser } from './keycloak';

/**
 * Drives the staff app's sign-in and step-up against the API and a Keycloak container the way
 * a browser would (KTD20), and answers Keycloak's one-time-code prompts like an authenticator
 * app. Every user and secret is synthetic and created per run.
 */

const totpPeriodMilliseconds = 30_000;

/**
 * An authenticator app holding one Keycloak one-time-code credential: HMAC-SHA1, six digits,
 * thirty seconds, keyed by the secret's UTF-8 bytes as Keycloak's setup form carries it.
 * Keycloak refuses a code it has already accepted and looks one period ahead, so each code
 * comes from a later period than the last, waiting for the clock when it must.
 */
export class Authenticator {
  private lastCounter = -1;

  constructor(readonly secret: string) {}

  async nextCode(): Promise<string> {
    const current = Math.floor(Date.now() / totpPeriodMilliseconds);
    let counter = Math.max(current, this.lastCounter + 1);
    if (counter > current + 1) {
      await new Promise((resolve) => setTimeout(resolve, (counter - 1) * totpPeriodMilliseconds - Date.now() + 50));
      counter = Math.max(Math.floor(Date.now() / totpPeriodMilliseconds), this.lastCounter + 1);
    }
    this.lastCounter = counter;
    return totpCode(this.secret, counter);
  }
}

export function totpCode(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', Buffer.from(secret, 'utf8')).update(message).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export interface Settled {
  readonly response: Response;
  readonly url: string;
}

/** What Keycloak asked for when a step-up reached it. */
export type StepUpPrompt =
  | { readonly kind: 'enrol'; readonly page: string; readonly url: string; readonly secret: string }
  | { readonly kind: 'code'; readonly page: string; readonly url: string }
  /** The session's sign-in level has lapsed in Keycloak, so it asks for the password first. */
  | { readonly kind: 'password'; readonly page: string; readonly url: string }
  | { readonly kind: 'other'; readonly page: string; readonly url: string };

export interface CommandAnswer {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
}

export class StaffBrowser {
  readonly browser = new TestBrowser();

  constructor(
    private readonly staff: string,
    private readonly staffAppOrigin: string,
  ) {}

  /** Follows redirects until Keycloak answers with a page or sends the browser to the staff app. */
  async settle(first: Response, url: string): Promise<Settled> {
    let response = first;
    let current = url;
    for (let hops = 0; hops < 12; hops += 1) {
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || location === null) {
        return { response, url: current };
      }
      current = new URL(location, current).toString();
      if (current.startsWith(this.staffAppOrigin)) {
        return { response, url: current };
      }
      response = await this.browser.get(current);
    }
    throw new Error('Too many redirects');
  }

  /** Submits the first form whose action matches, with extra fields, and settles. */
  async submit(page: string, action: RegExp, fields: Record<string, string>, url: string): Promise<Settled> {
    const form = formOn(page, action);
    if (form === null) {
      throw new Error(`No form matching ${String(action)} on the page`);
    }
    return this.settle(await this.browser.post(form.action, { ...form.fields, ...fields }), url);
  }

  /** Keycloak's login pages: the username first (organizations are enabled), then the password. */
  async logIn(page: string, user: SyntheticUser, url: string): Promise<Settled> {
    const first = await this.submit(
      page,
      /login-actions\/authenticate/,
      { username: user.username, password: user.password },
      url,
    );
    if (first.response.status !== 200) {
      return first;
    }
    const next = await first.response.text();
    const passwordForm = formOn(next, /login-actions\/authenticate/);
    if (passwordForm === null || 'username' in passwordForm.fields || !('password' in passwordForm.fields)) {
      return { response: new Response(next, { status: 200 }), url: first.url };
    }
    return this.submit(next, /login-actions\/authenticate/, { password: user.password }, first.url);
  }

  /** The API's sign-in, to Keycloak's first page. */
  async startSignIn(returnTo = '/rfqs'): Promise<Settled> {
    const url = `${this.staff}${staffAuthPaths.signIn}?returnTo=${encodeURIComponent(returnTo)}`;
    const start = await this.browser.get(url);
    const location = start.headers.get('location');
    if (start.status !== 303 || location === null) {
      throw new Error(`The sign-in did not start (${String(start.status)})`);
    }
    return this.settle(await this.browser.get(location), location);
  }

  /** Delivers Keycloak's redirect to the staff app's callback, through the app's /api proxy. */
  async deliverCallback(settled: Settled): Promise<Response | null> {
    if (!settled.url.startsWith(`${this.staffAppOrigin}${staffAuthPaths.callback}`)) {
      return null;
    }
    return this.browser.get(settled.url.replace(this.staffAppOrigin, this.staff));
  }

  async signIn(user: SyntheticUser): Promise<void> {
    const loginPage = await this.startSignIn();
    const callback = await this.deliverCallback(await this.logIn(await loginPage.response.text(), user, loginPage.url));
    this.expectSignedIn(callback);
  }

  /** Signs in through the customer identity provider linked to the realm. */
  async signInThroughBroker(idpUser: SyntheticUser, alias: string): Promise<void> {
    const loginPage = await this.startSignIn();
    const link = linkOn(await loginPage.response.text(), new RegExp(`/broker/${alias}/login`));
    if (link === null) {
      throw new Error('No identity provider link on the login page');
    }
    const brokerUrl = new URL(link, loginPage.url).toString();
    const idpPage = await this.settle(await this.browser.get(brokerUrl), brokerUrl);
    const settled = await this.logIn(await idpPage.response.text(), idpUser, idpPage.url);
    this.expectSignedIn(await this.deliverCallback(settled));
  }

  private expectSignedIn(callback: Response | null): void {
    if (callback?.status !== 303 || this.sessionCookie() === undefined) {
      throw new Error('The sign-in did not start a session');
    }
  }

  sessionCookie(): string | undefined {
    return this.browser.cookie(`${this.staff}/`, sessionCookieName);
  }

  /** The API's step-up for this browser's session, to what Keycloak asks for. */
  async startStepUp(returnTo: string): Promise<StepUpPrompt | { readonly kind: 'refused'; readonly location: string }> {
    const start = await this.browser.get(
      `${this.staff}${staffAuthPaths.stepUp}?returnTo=${encodeURIComponent(returnTo)}`,
    );
    const location = start.headers.get('location') ?? '';
    if (location.startsWith(this.staffAppOrigin)) {
      return { kind: 'refused', location };
    }
    return this.promptOf(await this.settle(await this.browser.get(location), location));
  }

  /** Answers a password prompt during a step-up; returns what Keycloak asks for next. */
  async answerPassword(prompt: StepUpPrompt, password: string): Promise<StepUpPrompt> {
    return this.promptOf(await this.submit(prompt.page, /login-actions\/authenticate/, { password }, prompt.url));
  }

  private async promptOf(settled: Settled): Promise<StepUpPrompt> {
    const page = await settled.response.text();
    const secret = formOn(page, /required-action/)?.fields.totpSecret;
    if (secret !== undefined) {
      return { kind: 'enrol', page, url: settled.url, secret };
    }
    const form = formOn(page, /login-actions\/authenticate/);
    if (form?.fields.otp !== undefined) {
      return { kind: 'code', page, url: settled.url };
    }
    if (form?.fields.password !== undefined) {
      return { kind: 'password', page, url: settled.url };
    }
    return { kind: 'other', page, url: settled.url };
  }

  /** Answers Keycloak's prompt; returns where the API's callback sent the browser. */
  async answerStepUp(prompt: StepUpPrompt, authenticator: Authenticator): Promise<string> {
    const settled =
      prompt.kind === 'enrol'
        ? await this.submit(
            prompt.page,
            /required-action/,
            { totp: await authenticator.nextCode(), userLabel: 'Synthetic authenticator' },
            prompt.url,
          )
        : await this.submit(
            prompt.page,
            /login-actions\/authenticate/,
            { otp: await authenticator.nextCode() },
            prompt.url,
          );
    const callback = await this.deliverCallback(settled);
    if (callback === null) {
      throw new Error('Keycloak did not return to the staff app after the step-up');
    }
    return callback.headers.get('location') ?? '';
  }

  /** Steps up with a factor this browser's user already holds, or enrols one; returns the authenticator. */
  async stepUp(
    returnTo: string,
    authenticator?: Authenticator,
  ): Promise<{ authenticator: Authenticator; location: string }> {
    const prompt = await this.startStepUp(returnTo);
    if (prompt.kind === 'enrol') {
      const enrolled = new Authenticator(prompt.secret);
      return { authenticator: enrolled, location: await this.answerStepUp(prompt, enrolled) };
    }
    if (prompt.kind !== 'code' || authenticator === undefined) {
      throw new Error(`The step-up could not be answered (${prompt.kind})`);
    }
    return { authenticator, location: await this.answerStepUp(prompt, authenticator) };
  }

  async command(name: string, body: unknown, idempotencyKey: string): Promise<CommandAnswer> {
    const response = await fetch(`${this.staff}${commandPath(name)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `${sessionCookieName}=${this.sessionCookie() ?? ''}`,
        [staffRequestHeader.name]: staffRequestHeader.value,
        [idempotencyKeyHeader]: idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const parsed: unknown = text === '' ? null : JSON.parse(text);
    return { status: response.status, headers: response.headers, body: parsed };
  }

  async sessionStatus(): Promise<number> {
    const response = await fetch(`${this.staff}${staffAuthPaths.session}`, {
      headers: { cookie: `${sessionCookieName}=${this.sessionCookie() ?? ''}` },
    });
    return response.status;
  }
}

/** Pinned by digest (KTD41): a local SMTP server whose API shows the mail Keycloak sends. */
export const mailCatcherImage =
  'axllent/mailpit:v1.27@sha256:e22dce5b36f93c77082e204a3942fb6b283b7896e057458400a4c88344c3df68';

const mailList = z.object({ messages: z.array(z.object({ ID: z.string() })) });
const mailMessage = z.object({ Text: z.string() });

export interface MailCatcher {
  readonly container: StartedTestContainer;
  /** How another container on the default network reaches its SMTP port. */
  readonly smtpHost: string;
  readonly smtpPort: string;
  /** The text of the newest mail to `address`, waiting for it to arrive. */
  latestTextTo(address: string): Promise<string>;
  stop(): Promise<void>;
}

export async function startMailCatcher(): Promise<MailCatcher> {
  const container = await new GenericContainer(mailCatcherImage)
    .withExposedPorts(8025, 1025)
    .withWaitStrategy(Wait.forHttp('/api/v1/messages', 8025).forStatusCode(200))
    .start();
  const api = `http://${container.getHost()}:${container.getMappedPort(8025)}/api/v1`;
  const [network = 'bridge'] = container.getNetworkNames();
  return {
    container,
    smtpHost: container.getIpAddress(network),
    smtpPort: '1025',
    async latestTextTo(address) {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const search = mailList.parse(
          await (await fetch(`${api}/search?query=${encodeURIComponent(`to:${address}`)}`)).json(),
        );
        const [newest] = search.messages;
        if (newest !== undefined) {
          return mailMessage.parse(await (await fetch(`${api}/message/${newest.ID}`)).json()).Text;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(`No mail arrived for ${address}`);
    },
    async stop() {
      await container.stop();
    },
  };
}
