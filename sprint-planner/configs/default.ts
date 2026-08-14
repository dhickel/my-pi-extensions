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
	roleRouter: { model: MODEL_PROFILES.lunaXhigh },
	brainstormWorker: { model: MODEL_PROFILES.deepseekProMax },
	brainstormSynthesis: { model: MODEL_PROFILES.lunaXhigh },
	brainstormRedTeam: { model: MODEL_PROFILES.solHigh },
	// ── Ironout ──
	ironoutAuthor: { model: MODEL_PROFILES.solHigh },
	ironoutReviewer: { model: MODEL_PROFILES.lunaXhigh },
	// ── Advanced planning ──
	planner: { model: MODEL_PROFILES.solHigh, maxSeniorCalls: 2, seniorAdvisor: "advisor" },
	advisor: { model: MODEL_PROFILES.solMax },
	decompositionReviewer: { model: MODEL_PROFILES.lunaXhigh, maxSeniorCalls: 1, seniorAdvisor: "advisor" },
	conceptsReviewer: { model: MODEL_PROFILES.lunaXhigh },
	orchestrationReviewer: { model: MODEL_PROFILES.lunaXhigh },
	phaseReviewer: { model: MODEL_PROFILES.lunaXhigh },
	// ── Execution / orchestration ──
	basicImplementer: { model: MODEL_PROFILES.deepseekFlashMax },
	advancedImplementer: { model: MODEL_PROFILES.deepseekProMax },
	phaseValidator: { model: MODEL_PROFILES.lunaXhigh },
	integrationValidator: { model: MODEL_PROFILES.lunaXhigh },
	seniorAgent: { model: MODEL_PROFILES.solMedium },
} as const satisfies SprintPlannerAgentConfiguration;
