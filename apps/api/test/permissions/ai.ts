import { definePermissions } from './matrix';

/**
 * The AI layer (U11): tenant admins choose the AI configuration (a KTD20 AI-key change, so with
 * step-up); buyers and quality engineers read and decide suggestions, and each target narrows
 * that to its own roles. No AI agent, supplier or system principal decides a suggestion.
 */
export default definePermissions({
  'ai.configureProvider': {
    kind: 'command',
    allow: ['tenant_admin'],
    purpose: 'administration',
    impact: 'ai_key_change',
    stepUp: true,
  },
  'ai.settings': { kind: 'query', allow: ['tenant_admin'] },
  'ai.acceptSuggestion': {
    kind: 'command',
    allow: ['buyer', 'quality_engineer'],
    purpose: 'business',
    impact: 'standard',
    stepUp: false,
  },
  'ai.rejectSuggestion': {
    kind: 'command',
    allow: ['buyer', 'quality_engineer'],
    purpose: 'business',
    impact: 'standard',
    stepUp: false,
  },
  'ai.suggestions': { kind: 'query', allow: ['buyer', 'quality_engineer'] },
});
