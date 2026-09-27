// @vitest-environment happy-dom
import { idempotencyKeyHeader, listMembersQuery, removeMemberCommand, type Member } from '@partledger/contracts';
import {
  createApiClient,
  createFixtureAdapter,
  createHttpAdapter,
  type ApiAdapter,
} from '@partledger/contracts/client';
import { createTenantFixtures, fixtureSignedInUserId } from '@partledger/contracts/fixtures';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiProvider } from '../../api/api-client';
import { pendingCommandStorageKey } from '../../auth/step-up';
import { SessionProvider } from '../../shell/session-provider';
import { createIdempotencyKeys } from './member-changes';
import { MembersPage, RemoveDialog } from './members';

interface Post {
  readonly path: string;
  readonly idempotencyKey: string | null;
  readonly body: unknown;
}

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

const stepUpRequired: Answer = {
  status: 401,
  body: { error: 'StepUpRequired', message: 'pl.error.stepUpRequired.recentAuthentication', params: {} },
};

const pendingCommandSchema = z.object({
  name: z.string(),
  body: z.object({ userId: z.string() }).loose(),
  idempotencyKey: z.string(),
});

let root: Root | null = null;
let posts: Post[] = [];
let answers: Answer[] = [];
let members: readonly Member[] = [];
let adapter: ApiAdapter;
const assign = vi.fn<(url: string | URL) => void>();

/** The API: reads come from the synthetic tenant, and every command goes through `fetch`. */
function stubbedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  const text = typeof init?.body === 'string' ? init.body : '';
  posts.push({
    path,
    idempotencyKey: new Headers(init?.headers).get(idempotencyKeyHeader),
    body: text === '' ? null : z.unknown().parse(JSON.parse(text)),
  });
  const answer = answers.shift() ?? { status: 200, body: { userId: 'synthetic', endedSessions: 1 } };
  return Promise.resolve(
    new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

beforeEach(async () => {
  posts = [];
  answers = [];
  assign.mockReset();
  window.sessionStorage.clear();
  vi.stubGlobal('fetch', stubbedFetch);
  vi.spyOn(window.location, 'assign').mockImplementation(assign);
  const tenant = createTenantFixtures();
  const fixtures = createFixtureAdapter(tenant.queries, { commands: tenant.commands, session: tenant.session });
  const http = createHttpAdapter({ fetch: (url, init) => window.fetch(url, init) });
  adapter = {
    query: (name, input) => fixtures.query(name, input),
    session: () => fixtures.session(),
    signOut: () => fixtures.signOut(),
    command: (name, input, idempotencyKey) => http.command(name, input, idempotencyKey),
  };
  const listed = await createApiClient(fixtures).query(listMembersQuery, {});
  members = listed.ok ? listed.value.members : [];
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(node: ReactNode): void {
  const container = document.createElement('div');
  document.body.append(container);
  const created = createRoot(container);
  root = created;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    created.render(
      <ApiProvider client={createApiClient(adapter)} kind="http">
        <QueryClientProvider client={queryClient}>
          <SessionProvider>{node}</SessionProvider>
        </QueryClientProvider>
      </ApiProvider>,
    );
  });
}

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) {
      return;
    }
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
    });
  }
  throw new Error('The page never reached the expected state');
}

function button(name: string): HTMLButtonElement | null {
  return (
    [...document.body.querySelectorAll('button')].find(
      (candidate) => (candidate.getAttribute('aria-label') ?? candidate.textContent.trim()) === name,
    ) ?? null
  );
}

async function click(name: string): Promise<void> {
  await until(() => button(name) !== null);
  act(() => {
    button(name)?.click();
  });
}

function pageText(): string {
  return document.body.textContent;
}

function otherMember(): Member {
  const member = members.find(
    (candidate) => candidate.userId !== fixtureSignedInUserId && candidate.roles.length === 1,
  );
  if (member === undefined) {
    throw new Error('The synthetic tenant needs a member with one role');
  }
  return member;
}

function storedPendingCommand(): z.infer<typeof pendingCommandSchema> | null {
  const stored = window.sessionStorage.getItem(pendingCommandStorageKey);
  return stored === null ? null : pendingCommandSchema.parse(JSON.parse(stored));
}

function mountRemoveDialog(member: Member): void {
  mount(
    <RemoveDialog
      member={member}
      keys={createIdempotencyKeys()}
      returnFocus={() => null}
      onClose={() => undefined}
      onRemoved={() => undefined}
    />,
  );
}

describe('removing a member who needs the administrator to confirm their identity', () => {
  it('keeps the refused removal with the same key and body when the administrator confirms their identity', async () => {
    const member = otherMember();
    answers = [stepUpRequired, stepUpRequired];
    mountRemoveDialog(member);
    await click('Remove member');
    await until(() => pageText().includes('This change needs you to confirm your identity again.'));

    await click('Confirm your identity');
    await until(() => assign.mock.calls.length === 1);

    const [firstAttempt] = posts;
    const pending = storedPendingCommand();
    expect(pending).toMatchObject({ name: removeMemberCommand.name, body: { userId: member.userId } });
    expect(pending?.idempotencyKey).toBe(firstAttempt?.idempotencyKey);
    expect(firstAttempt?.body).toEqual({ userId: member.userId });
    expect(assign.mock.calls[0]?.[0]).toContain('/api/v1/auth/step-up?returnTo=');
  });

  it('does not offer to confirm an identity for any other refusal', async () => {
    answers = [{ status: 409, body: { error: 'Conflict', message: 'pl.error.conflict.lastTenantAdmin', params: {} } }];
    mountRemoveDialog(otherMember());
    await click('Remove member');
    await until(() => posts.length === 1 && document.body.querySelector('[role="alert"]') !== null);

    expect(button('Confirm your identity')).toBeNull();
    expect(storedPendingCommand()).toBeNull();
  });
});

describe('the members page after the administrator confirmed their identity', () => {
  it('sends the kept removal exactly once, with its key, and says the change is made', async () => {
    const member = otherMember();
    window.sessionStorage.setItem(
      pendingCommandStorageKey,
      JSON.stringify({
        name: removeMemberCommand.name,
        body: { userId: member.userId },
        idempotencyKey: 'synthetic-removal-key',
        savedAt: Date.now(),
      }),
    );
    mount(<MembersPage members={members} />);
    await until(() => pageText().includes('Your identity is confirmed and the change is made.'));

    expect(posts).toEqual([
      {
        path: `/api/v1/commands/${removeMemberCommand.name}`,
        idempotencyKey: 'synthetic-removal-key',
        body: { userId: member.userId },
      },
    ]);
    expect(storedPendingCommand()).toBeNull();
  });

  it('a two-command role change refused at the first command never shows success for a partial change', async () => {
    const member = otherMember();
    answers = [stepUpRequired];
    mount(<MembersPage members={members} />);
    await click(`Change roles for ${member.displayName}`);
    await until(() => document.body.querySelectorAll('[role="checkbox"]').length > 0);
    // Grants one role and revokes the member's only one: two commands.
    const checkboxes = [...document.body.querySelectorAll<HTMLElement>('[role="checkbox"]')];
    const unchecked = checkboxes.find((checkbox) => checkbox.getAttribute('aria-checked') === 'false');
    const checked = checkboxes.find((checkbox) => checkbox.getAttribute('aria-checked') === 'true');
    act(() => {
      unchecked?.click();
      checked?.click();
    });
    await click('Save roles');
    await until(() => pageText().includes('Confirm it, then save the roles again.'));
    expect(posts).toHaveLength(1);

    await click('Confirm your identity');
    expect(assign).toHaveBeenCalledTimes(1);
    expect(storedPendingCommand()).toBeNull();

    // Back from the step-up: nothing is replayed and nothing claims the change was made.
    act(() => {
      root?.unmount();
    });
    root = null;
    document.body.replaceChildren();
    mount(<MembersPage members={members} />);
    await until(() => button('Invite member') !== null);
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    });
    expect(posts).toHaveLength(1);
    expect(pageText()).not.toContain('Your identity is confirmed and the change is made.');
    expect(pageText()).not.toContain('were saved.');
  });
});
