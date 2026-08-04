import { defaultSprintPlannerAgentConfiguration } from "./default.ts";
import { liteSprintPlannerAgentConfiguration } from "./lite.ts";
import type { SprintPlannerAgentConfiguration } from "../types.ts";

/** Named installed configurations. Add future configuration files here. */
export const SPRINT_PLANNER_AGENT_CONFIGURATIONS = {
	default: defaultSprintPlannerAgentConfiguration,
	lite: liteSprintPlannerAgentConfiguration,
} as const satisfies Record<string, SprintPlannerAgentConfiguration>;

/** Configuration selection is intentionally fixed until a selection contract exists. */
export const DEFAULT_SPRINT_PLANNER_AGENT_CONFIGURATION = "lite";

/** Load the fixed current configuration during extension initialization. */
export function loadDefaultSprintPlannerAgentConfiguration(): SprintPlannerAgentConfiguration {
	return SPRINT_PLANNER_AGENT_CONFIGURATIONS[DEFAULT_SPRINT_PLANNER_AGENT_CONFIGURATION];
}
