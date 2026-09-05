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
	brainstormWorker1: { model: MODEL_PROFILES.lunaMax },
	brainstormWorker2: { model: MODEL_PROFILES.deepseekFlashMax },
	brainstormSynthesis: { model: MODEL_PROFILES.lunaXhigh },
	brainstormRedTeam: { model: MODEL_PROFILES.astraHigh },
	// ── Red team ──
	redTeamValidator: { model: MODEL_PROFILES.astraHigh },
	// ── Ironout ──
	ironoutAuthor: { model: MODEL_PROFILES.astraHigh },
	ironoutReviewer: { model: MODEL_PROFILES.lunaXhigh },
	// ── Advanced planning ──
	planner: { model: MODEL_PROFILES.astraHigh, maxSeniorCalls: 2, seniorAdvisor: "advisor" },
	advisor: { model: MODEL_PROFILES.astraMax },
	decompositionReviewer: { model: MODEL_PROFILES.lunaXhigh, maxSeniorCalls: 1, seniorAdvisor: "advisor" },
	conceptsReviewer: { model: MODEL_PROFILES.lunaXhigh },
	orchestrationReviewer: { model: MODEL_PROFILES.lunaXhigh },
	phaseReviewer: { model: MODEL_PROFILES.lunaXhigh },
	// ── Execution / orchestration ──
	basicImplementer: { model: MODEL_PROFILES.lunaHigh },
	advancedImplementer: { model: MODEL_PROFILES.lunaMax },
	phaseValidator: { model: MODEL_PROFILES.lunaXhigh },
	integrationValidator: { model: MODEL_PROFILES.lunaXhigh },
	seniorAgent: { model: MODEL_PROFILES.astraMedium },
} as const satisfies SprintPlannerAgentConfiguration;
