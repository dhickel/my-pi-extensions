import { MODEL_PROFILES, type SprintPlannerAgentConfiguration } from "../types.ts";

/**
 * The installed sprint-planner model configuration. Keep this assignment
 * shape aligned with SprintPlannerAgentConfiguration.
 *
 * Planning agents (brainstorm, ironout, advanced planning) plus execution
 * agents referenced by the orchestrate skill.
 */
export const defaultSprintPlannerAgentConfiguration = {
	// ── Brainstorm ──
	roleRouter: { model: MODEL_PROFILES.solHigh },
	brainstormWorker: { model: MODEL_PROFILES.deepseekProMax },
	brainstormSynthesis: { model: MODEL_PROFILES.solHigh },
	brainstormRedTeam: { model: MODEL_PROFILES.solHigh },
	// ── Ironout ──
	ironoutAuthor: { model: MODEL_PROFILES.solHigh },
	ironoutReviewer: { model: MODEL_PROFILES.terraHigh },
	// ── Advanced planning ──
	planner: { model: MODEL_PROFILES.solHigh, maxSeniorCalls: 2, seniorAdvisor: "advisor" },
	advisor: { model: MODEL_PROFILES.solMax },
	decompositionReviewer: { model: MODEL_PROFILES.terraHigh, maxSeniorCalls: 1, seniorAdvisor: "advisor" },
	conceptsReviewer: { model: MODEL_PROFILES.terraHigh },
	orchestrationReviewer: { model: MODEL_PROFILES.terraHigh },
	phaseReviewer: { model: MODEL_PROFILES.terraHigh },
	// ── Execution / orchestration ──
	implementationWorker: { model: MODEL_PROFILES.deepseekProMax },
	phaseValidator: { model: MODEL_PROFILES.terraHigh },
	integrationValidator: { model: MODEL_PROFILES.terraHigh },
	executionAdvisor: { model: MODEL_PROFILES.solXhigh },
	seniorAgent: { model: MODEL_PROFILES.solHigh },
} as const satisfies SprintPlannerAgentConfiguration;
