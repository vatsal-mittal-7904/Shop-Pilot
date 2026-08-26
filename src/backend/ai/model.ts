import { google } from '@ai-sdk/google'

/**
 * The single source of truth for which Gemini model this app talks to.
 *
 * This module exists because the model id used to be hardcoded in two places
 * -- src/app/api/chat/route.ts and src/backend/actions/intent.ts -- which is
 * exactly one place too many. Changing a model meant editing both, and a miss
 * in either one produces a 404 from the Gemini API on every request:
 *
 *   AI_APICallError: models/<id> is not found for API version v1beta,
 *   or is not supported for generateContent.
 *
 * That failure is especially unpleasant in intent.ts, where parseBuyerIntent()
 * swallows all errors and returns null by design -- so a bad model id there
 * doesn't surface as an error at all. It degrades silently into search_catalog
 * running with no buyer intent, which returns generic products and looks like
 * bad AI rather than a broken configuration.
 *
 * Overridable via env so a model id that the API has retired can be swapped
 * without a code change. To find out what the key in use can actually serve:
 *
 *   curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GOOGLE_GENERATIVE_AI_API_KEY" \
 *     | grep '"name"'
 *
 * NOTE: @ai-sdk/google@0.0.52's GoogleGenerativeAIModelId type union only
 * lists gemini-1.5-era ids, but it ends in `(string & {})` -- so any string
 * typechecks. The union is a stale autocomplete hint, not a constraint, and
 * TypeScript will not catch a retired id here. Only the API will.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash'

/** The chat/tool-calling model. Used by the agent route and intent extraction. */
export function geminiModel() {
  return google(GEMINI_MODEL)
}
