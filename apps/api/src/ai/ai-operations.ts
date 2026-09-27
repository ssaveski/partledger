import {
  acceptSuggestionCommand,
  aiSettingsQuery,
  configureAiProviderCommand,
  rejectSuggestionCommand,
  suggestionsQuery,
} from '@partledger/contracts';

import { registerCommand, registerQuery, type CommandRegistration, type QueryRegistration } from '../commands/handlers';
import { AiSettingsHandler, ConfigureAiProviderHandler } from './ai-settings.handlers';
import { AcceptSuggestionHandler, RejectSuggestionHandler, SuggestionsHandler } from './suggestions.commands';

export const aiCommands: readonly CommandRegistration[] = [
  registerCommand(configureAiProviderCommand, ConfigureAiProviderHandler),
  registerCommand(acceptSuggestionCommand, AcceptSuggestionHandler),
  registerCommand(rejectSuggestionCommand, RejectSuggestionHandler),
];

export const aiQueries: readonly QueryRegistration[] = [
  registerQuery(aiSettingsQuery, AiSettingsHandler),
  registerQuery(suggestionsQuery, SuggestionsHandler),
];
