import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-deal-suggestions", "index.ts"),
  "utf8",
);

describe("ai-deal-suggestions source guards", () => {
  it("does not return canned insight suggestions when provider configuration is unavailable", () => {
    expect(source).toMatch(/OPENAI_NOT_CONFIGURED/);
    expect(source).toMatch(/status:\s*503/);
    expect(source).toMatch(/routerCanUseGemini/);
    expect(source).not.toMatch(/fallbackSuggestions/);
    expect(source).not.toMatch(/Expand your lineup/);
    expect(source).not.toMatch(/Weekend pastry pairing/);
    expect(source).not.toMatch(/Tell your origin story/);

    const keyMissingIndex = source.indexOf("if (!openAiKey && !routerCanUseGemini)");
    const generationIndex = source.indexOf("generation = await generateStructuredText");
    expect(keyMissingIndex).toBeGreaterThan(-1);
    expect(generationIndex).toBeGreaterThan(keyMissingIndex);
  });

  it("routes insight generation through the shared provider router", () => {
    expect(source).toMatch(/generateStructuredText/);
    expect(source).toMatch(/resolveAiTextProviderConfig/);
    expect(source).toMatch(/logDealSuggestionProviderAttempts/);
    expect(source).not.toMatch(/fetch\("https:\/\/api\.openai\.com\/v1\/chat\/completions"/);
    expect(source).not.toMatch(/resolveOpenAiChatModel/);
  });

  it("does not bias insight prompts with unsupported craft or freshness claims", () => {
    expect(source).toMatch(/practical local-business advisor/);
    expect(source).toMatch(/verified strengths from the supplied business and deal data/);
    expect(source).toMatch(/Do not invent ingredients, sourcing, freshness, craft, health, popularity, or availability claims/);
    expect(source).not.toMatch(/craft-focused/);
    expect(source).not.toMatch(/independent caf/);
    expect(source).not.toMatch(/quality and craft/);
    expect(source).not.toMatch(/ingredient highlights/);
  });

  it("does not return raw provider error details to the client", () => {
    expect(source).not.toMatch(/const text = await aiRes\.text\(\)/);
    expect(source).not.toMatch(/details:\s*text/);
    expect(source).not.toMatch(/errorMessage:\s*text\.slice/);

    const providerFailureIndex = source.indexOf("AI_GENERATION_FAILED");
    expect(providerFailureIndex).toBeGreaterThan(-1);
    const providerFailureBlock = source.slice(providerFailureIndex - 1200, providerFailureIndex + 600);
    expect(providerFailureBlock).toMatch(/const attempts = \(err as \{ attempts\?: ProviderAttempt\[\] \}\)\?\.attempts \?\? \[\]/);
    expect(providerFailureBlock).toMatch(/logDealSuggestionProviderAttempts/);
    expect(providerFailureBlock).toMatch(/status:\s*502/);
    expect(providerFailureBlock).toMatch(/error_code:\s*"AI_GENERATION_FAILED"/);
  });

  it("does not log raw text-provider config exception text", () => {
    const configErrorIndex = source.indexOf('event: "text_provider_config_error"');
    expect(configErrorIndex).toBeGreaterThan(-1);

    const configErrorBlock = source.slice(configErrorIndex - 220, configErrorIndex + 260);
    expect(configErrorBlock).toMatch(/errorCode:\s*"AI_TEXT_CONFIG_INVALID"/);
    expect(configErrorBlock).not.toMatch(/String\(err\)/);
    expect(configErrorBlock).not.toMatch(/err:\s*String/);
  });

  describe("AI_SUGGESTIONS_V2_ENABLED: server-side stats + repetition memory", () => {
    it("defaults off, reading a dedicated env flag", () => {
      expect(source).toMatch(
        /const SUGGESTIONS_V2_ENABLED = Deno\.env\.get\("AI_SUGGESTIONS_V2_ENABLED"\) === "true";/,
      );
    });

    it("only fetches server-side context and previous suggestions when the flag is on", () => {
      expect(source).toMatch(
        /const serverContext = SUGGESTIONS_V2_ENABLED\s*\n\s*\? await fetchServerSideSuggestionContext\(supabase, business_id\)\s*\n\s*: null;/,
      );
      expect(source).toMatch(
        /const previousSuggestionTitles = SUGGESTIONS_V2_ENABLED\s*\n\s*\? await fetchPreviousSuggestionTitles\(supabase, business_id\)\s*\n\s*: \[\];/,
      );
    });

    it("falls back to the client-supplied stats byte-identically when serverContext is null", () => {
      expect(source).toMatch(
        /const effectiveWeeklyClaimsByDay = serverContext \? serverContext\.weeklyClaimsByDay : weekly_claims_by_day;/,
      );
      expect(source).toMatch(
        /const effectiveTopDealTitles = serverContext \? serverContext\.topDealTitles : top_deal_titles;/,
      );
      expect(source).toMatch(
        /const effectiveTotalClaims = serverContext \? serverContext\.totalClaims : total_claims;/,
      );
      expect(source).toMatch(
        /const effectiveTotalRedeems = serverContext \? serverContext\.totalRedeems : total_redeems;/,
      );
    });

    it("only adds the anti-repetition system-prompt rule and previously-suggested context line under the flag", () => {
      expect(source).toMatch(
        /\.\.\.\(SUGGESTIONS_V2_ENABLED\s*\n\s*\? \["- Do not repeat a suggestion equivalent to a deal already running/,
      );
      expect(source).toMatch(
        /if \(SUGGESTIONS_V2_ENABLED && previousSuggestionTitles\.length > 0\) \{/,
      );
    });

    it("only persists response_payload on the success log when the flag is on", () => {
      const successLogIndex = source.indexOf("request_hash: `deal_suggestions:");
      expect(successLogIndex).toBeGreaterThan(-1);
      const successLogBlock = source.slice(successLogIndex, successLogIndex + 500);
      expect(successLogBlock).toMatch(
        /\.\.\.\(SUGGESTIONS_V2_ENABLED \? \{ response_payload: result \} : \{\}\),/,
      );
    });

    it("reuses the already-verified business ownership (no second ownership check added)", () => {
      // fetchServerSideSuggestionContext/fetchPreviousSuggestionTitles both take
      // a plain businessId and never re-query the businesses table.
      const helperStart = source.indexOf("async function fetchServerSideSuggestionContext");
      const helperEnd = source.indexOf("serve(async (req)");
      expect(helperStart).toBeGreaterThan(-1);
      expect(helperEnd).toBeGreaterThan(helperStart);
      const helpersBlock = source.slice(helperStart, helperEnd);
      expect(helpersBlock).not.toMatch(/\.from\("businesses"\)/);
    });
  });
});
