import { definePermissions } from './matrix';

/** Parts (U10): buyers and quality engineers maintain the parts list; every staff role but the administrator reads it. */
export default definePermissions({
  'parts.create': {
    kind: 'command',
    allow: ['buyer', 'quality_engineer'],
    purpose: 'business',
    impact: 'standard',
    stepUp: false,
  },
  'parts.update': {
    kind: 'command',
    allow: ['buyer', 'quality_engineer'],
    purpose: 'business',
    impact: 'standard',
    stepUp: false,
  },
  'parts.setActive': {
    kind: 'command',
    allow: ['buyer', 'quality_engineer'],
    purpose: 'business',
    impact: 'standard',
    stepUp: false,
  },
  'parts.list': { kind: 'query', allow: ['buyer', 'quality_engineer', 'approver', 'auditor'] },
});
