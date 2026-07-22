/**
 * Iteration Reflection Module
 *
 * Uses Claude Haiku to reflect on each iteration and provide quality assessment,
 * confidence levels, and guidance for next iteration.
 * Cost: ~$0.00001 per reflection (Haiku pricing).
 */

import type { AgentExecutionContext } from "./agentLoopExecutor";

export interface ReflectionResult {
  observation: string;
  qualityScore: number; // 0-1
  confidenceLevel: number; // 0-1
  shouldContinue: boolean;
  nextFocus?: string;
}

/**
 * Build a prompt for Haiku reflection on iteration results.
 */
function buildReflectionPrompt(
  taskDescription: string,
  iterationOutput: unknown,
  context: AgentExecutionContext,
  iterationNum: number,
  maxIterations: number,
): string {
  const outputStr =
    typeof iterationOutput === "string"
      ? iterationOutput
      : JSON.stringify(iterationOutput, null, 2).slice(0, 500);

  return `You are analyzing iteration #${iterationNum} of ${maxIterations} for a task execution.

Task: ${taskDescription}
Agent Archetype: ${context.agentArchetype}
Complexity: ${context.complexity}

Current Iteration Output:
${outputStr}

Please provide a brief assessment in JSON format with:
- observation: Short 1-2 sentence assessment of this iteration's progress
- qualityScore: 0-1 score of output quality
- confidenceLevel: 0-1 confidence in this result
- shouldContinue: boolean, whether another iteration would be beneficial
- nextFocus: (optional) brief suggestion for next iteration focus

Respond ONLY with valid JSON, no markdown.`;
}

/**
 * Parse Haiku reflection response.
 */
function parseReflectionResponse(rawResponse: string): ReflectionResult {
  try {
    // Extract JSON from response (may contain extra text)
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      observation: String(parsed.observation || ""),
      qualityScore: Math.min(1, Math.max(0, Number(parsed.qualityScore) || 0.5)),
      confidenceLevel: Math.min(1, Math.max(0, Number(parsed.confidenceLevel) || 0.5)),
      shouldContinue: Boolean(parsed.shouldContinue),
      ...(parsed.nextFocus ? { nextFocus: String(parsed.nextFocus) } : {}),
    };
  } catch (error) {
    // Fallback to safe defaults if parsing fails
    return {
      observation: "Reflection processing error — defaulting to continue",
      qualityScore: 0.5,
      confidenceLevel: 0.3,
      shouldContinue: true,
    };
  }
}

/**
 * Reflect on iteration results using Claude Haiku.
 */
export async function reflectOnIteration(
  taskDescription: string,
  iterationOutput: unknown,
  context: AgentExecutionContext,
  iterationNum: number,
  maxIterations: number,
): Promise<ReflectionResult> {
  const prompt = buildReflectionPrompt(
    taskDescription,
    iterationOutput,
    context,
    iterationNum,
    maxIterations,
  );

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return generateSyntheticReflection(iterationNum, maxIterations, context.complexity);
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      console.error(`[reflectOnIteration] API error ${res.status}`);
      return generateSyntheticReflection(iterationNum, maxIterations, context.complexity);
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";
    return parseReflectionResponse(text);
  } catch (error) {
    console.error("Reflection error:", error);
    return {
      observation: "Reflection failed — proceeding with default assessment",
      qualityScore: 0.5,
      confidenceLevel: 0.3,
      shouldContinue: iterationNum < maxIterations,
    };
  }
}

/**
 * Generate synthetic reflection (used when API is unavailable).
 * This helps testing and development without API calls.
 */
function generateSyntheticReflection(
  iterationNum: number,
  maxIterations: number,
  complexity: string,
): ReflectionResult {
  // Simulate quality improvement as iterations progress
  const baseQuality = 0.65;
  const improvementPerIteration = complexity === "expert" ? 0.08 : 0.05;
  const qualityScore = Math.min(0.95, baseQuality + improvementPerIteration * (iterationNum - 1));

  // Confidence increases with iterations
  const confidenceLevel = Math.min(0.9, 0.4 + 0.12 * (iterationNum - 1));

  // Continue if quality is improving and not at max
  const shouldContinue = iterationNum < maxIterations && qualityScore < 0.85;

  return {
    observation: `Iteration ${iterationNum} complete. Quality score: ${qualityScore.toFixed(2)}.`,
    qualityScore,
    confidenceLevel,
    shouldContinue,
    ...(iterationNum < maxIterations
      ? { nextFocus: `Refine based on iteration ${iterationNum} insights` }
      : {}),
  };
}
