import { MODEL_PROFILES, type SprintPlannerAgentConfiguration } from "../types.ts";

/**
 * Lite sprint-planner model configuration. Every agent is deepseek-v4-pro:max.
 */
export const liteSprintPlannerAgentConfiguration = {
	// ── Brainstorm ──
	roleRouter: { model: MODEL_PROFILES.deepseekProMax },
	brainstormWorker: { model: MODEL_PROFILES.deepseekProMax },
	brainstormSynthesis: { model: MODEL_PROFILES.deepseekProMax },
	brainstormRedTeam: { model: MODEL_PROFILES.deepseekProMax },
	// ── Ironout ──
	ironoutAuthor: { model: MODEL_PROFILES.deepseekProMax },
	ironoutReviewer: { model: MODEL_PROFILES.deepseekProMax },
	// ── Advanced planning ──
	planner: { model: MODEL_PROFILES.deepseekProMax, maxSeniorCalls: 2, seniorAdvisor: "advisor" },
	advisor: { model: MODEL_PROFILES.deepseekProMax },
	decompositionReviewer: { model: MODEL_PROFILES.deepseekProMax, maxSeniorCalls: 1, seniorAdvisor: "advisor" },
	conceptsReviewer: { model: MODEL_PROFILES.deepseekProMax },
	orchestrationReviewer: { model: MODEL_PROFILES.deepseekProMax },
	phaseReviewer: { model: MODEL_PROFILES.deepseekProMax },
	// ── Execution / orchestration ──
	implementationWorker: { model: MODEL_PROFILES.deepseekFlashMax },
	phaseValidator: { model: MODEL_PROFILES.deepseekProMax },
	integrationValidator: { model: MODEL_PROFILES.deepseekProMax },
	executionAdvisor: { model: MODEL_PROFILES.deepseekProMax },
} as const satisfies SprintPlannerAgentConfiguration;
