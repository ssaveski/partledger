import { describe, expect, it } from 'vitest';

import { createApiClient } from '../client/api-client';
import { createFixtureAdapter } from '../client/fixture-adapter';
import {
  portalEvidenceRequestsQuery,
  portalOutcomeQuery,
  portalResponseQuery,
  portalSessionQuery,
  portalSubmissionQuery,
  submissionReadSchema,
} from '../portal/queries';
import {
  exchangeFixtureLink,
  portalFixtureHandlers,
  portalFixtureLinks,
  portalFixtureOutputs,
  portalFixtureScenarios,
  type PortalFixtureScenario,
} from './portal';

function clientFor(scenario: PortalFixtureScenario | null) {
  const linkId = scenario === null ? null : portalFixtureLinks[scenario].linkId;
  return createApiClient(createFixtureAdapter(portalFixtureHandlers(() => linkId)));
}

const ownLineIds = new Set(
  portalFixtureOutputs.allLines.filter((line) => line.assignedToSessionSupplier).map((line) => line.lineId),
);

const otherLines = portalFixtureOutputs.allLines.filter((line) => !line.assignedToSessionSupplier);

describe('the synthetic supplier links', () => {
  it('open a session only with the right secret of an active link', () => {
    const open = portalFixtureLinks.open;
    expect(exchangeFixtureLink(open.linkId, open.secret)).toBe(true);
    expect(exchangeFixtureLink(open.linkId, portalFixtureLinks.closed.secret)).toBe(false);
    expect(exchangeFixtureLink(portalFixtureLinks.expired.linkId, portalFixtureLinks.expired.secret)).toBe(false);
    expect(exchangeFixtureLink(portalFixtureLinks.revoked.linkId, portalFixtureLinks.revoked.secret)).toBe(false);
    expect(exchangeFixtureLink('00000000-0000-4000-8000-000000000000', open.secret)).toBe(false);
  });

  it('refuse every read without an active session, as the uniform 401 would', async () => {
    for (const scenario of [null, 'expired', 'revoked'] as const) {
      const client = clientFor(scenario);
      for (const declaration of [portalSessionQuery, portalResponseQuery, portalOutcomeQuery]) {
        expect(await client.query(declaration, {})).toEqual({ ok: false, failure: { kind: 'unauthenticated' } });
      }
    }
  });

  it('describe every active scenario in the declared session shape', () => {
    for (const session of portalFixtureOutputs.sessions) {
      expect(portalSessionQuery.output.safeParse(session).success).toBe(true);
    }
    expect(portalFixtureScenarios.length).toBe(portalFixtureOutputs.sessions.length);
  });

  it('let an open request be answered, a closed one read, and a sealed one show its outcome', async () => {
    const views = async (scenario: PortalFixtureScenario) => {
      const result = await clientFor(scenario).query(portalSessionQuery, {});
      return result.ok ? result.value.views : null;
    };
    expect(await views('open')).toEqual(['respond', 'submission']);
    expect(await views('closed')).toEqual(['submission']);
    expect(await views('sealed')).toEqual(['outcome', 'submission']);
    expect(await views('evidence')).toEqual(['evidence']);
  });

  it('refuse a screen the link does not open now as not permitted', async () => {
    const result = await clientFor('open').query(portalOutcomeQuery, {});
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'refused', error: 'Forbidden', message: 'pl.error.forbidden.notPermitted', params: {} },
    });
    expect((await clientFor('closed').query(portalResponseQuery, {})).ok).toBe(false);
    expect((await clientFor('evidence').query(portalSubmissionQuery, {})).ok).toBe(false);
  });
});

describe('what the session supplier receives', () => {
  it('includes lines assigned only to another supplier in the fixtures, so the projection is tested', () => {
    expect(otherLines.length).toBeGreaterThan(0);
  });

  it('is its three assigned lines of the open request, one of them changed since it last submitted', async () => {
    const result = await clientFor('open').query(portalResponseQuery, {});
    if (!result.ok) {
      throw new Error('The open link serves its response form');
    }
    expect(result.value.lines.map((line) => line.lineNumber)).toEqual([1, 3, 4]);
    expect(result.value.lines.filter((line) => line.changed !== null).map((line) => line.lineNumber)).toEqual([3]);
  });

  it('never carries a line, an answer or the name of another supplier, on any screen', async () => {
    const reads = [
      await clientFor('open').query(portalResponseQuery, {}),
      await clientFor('open').query(portalSubmissionQuery, {}),
      await clientFor('closed').query(portalSubmissionQuery, {}),
      await clientFor('sealed').query(portalSubmissionQuery, {}),
      await clientFor('sealed').query(portalOutcomeQuery, {}),
    ];
    for (const read of reads) {
      if (!read.ok) {
        throw new Error('Every read of an active link succeeds');
      }
      const lines = 'lines' in read.value ? read.value.lines : [];
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(ownLineIds.has(line.lineId), line.partNumber).toBe(true);
      }
      const body = JSON.stringify(read.value);
      expect(body).not.toContain('Kestrel');
      for (const other of otherLines) {
        expect(body).not.toContain(other.lineId);
      }
    }
  });

  it('is the outcome of its own lines only, with nothing about who else won', async () => {
    const result = await clientFor('sealed').query(portalOutcomeQuery, {});
    if (!result.ok) {
      throw new Error('The sealed link serves its outcome');
    }
    expect(result.value.lines.map((line) => [line.lineNumber, line.result])).toEqual([
      [1, 'notAwarded'],
      [2, 'awarded'],
      [5, 'notAwarded'],
    ]);
  });

  it('marks a submitted line the buyer changed afterwards', () => {
    const open = submissionReadSchema.parse(portalFixtureOutputs.submissions[0]);
    if (open.availability !== 'submitted') {
      throw new Error('The open request has a submission');
    }
    expect(open.lines.filter((line) => line.changedSince).map((line) => line.lineNumber)).toEqual([3]);
  });

  it('lists the evidence requests of an evidence link in every status', async () => {
    const result = await clientFor('evidence').query(portalEvidenceRequestsQuery, {});
    if (!result.ok) {
      throw new Error('The evidence link serves its requests');
    }
    expect(new Set(result.value.requests.map((request) => request.status))).toEqual(
      new Set(['requested', 'underReview', 'accepted', 'rejected']),
    );
  });
});
