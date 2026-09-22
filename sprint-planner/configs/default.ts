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
	roleRouter: { model: MODEL_PROFILES.gpt6LunaXhigh },
	brainstormWorker1: { model: MODEL_PROFILES.gpt6LunaMax },
	brainstormWorker2: { model: MODEL_PROFILES.deepseekFlashMax },
	brainstormSynthesis: { model: MODEL_PROFILES.gpt6LunaXhigh },
	brainstormRedTeam: { model: MODEL_PROFILES.astraHigh },
	// ── Red team ──
	redTeamValidator: { model: MODEL_PROFILES.astraHigh },
	// ── Ironout ──
	ironoutAuthor: { model: MODEL_PROFILES.astraHigh },
	ironoutReviewer: { model: MODEL_PROFILES.gpt6LunaXhigh },
	// ── Advanced planning ──
	planner: { model: MODEL_PROFILES.astraHigh, maxSeniorCalls: 2, seniorAdvisor: "advisor" },
	advisor: { model: MODEL_PROFILES.astraMax },
	decompositionReviewer: { model: MODEL_PROFILES.gpt6LunaXhigh, maxSeniorCalls: 1, seniorAdvisor: "advisor" },
	conceptsReviewer: { model: MODEL_PROFILES.gpt6LunaXhigh },
	orchestrationReviewer: { model: MODEL_PROFILES.gpt6LunaXhigh },
	phaseReviewer: { model: MODEL_PROFILES.gpt6LunaXhigh },
	// ── Execution / orchestration ──
	basicImplementer: { model: MODEL_PROFILES.gpt6LunaHigh },
	advancedImplementer: { model: MODEL_PROFILES.gpt6LunaMax },
	phaseValidator: { model: MODEL_PROFILES.gpt6LunaXhigh },
	integrationValidator: { model: MODEL_PROFILES.gpt6LunaXhigh },
	seniorAgent: { model: MODEL_PROFILES.gpt6SolHigh },
} as const satisfies SprintPlannerAgentConfiguration;
