import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { SprintPlannerAgentConfiguration, SprintPlannerAgentId } from "./types.ts";

export const AGENT_ASSIGNMENT_REQUEST_CHANNEL = "sprint-planner:agent-assignment:request:v1";
export const AGENT_ASSIGNMENT_RESPONSE_PREFIX = "sprint-planner:agent-assignment:response:v1:";

function validRequestId(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value);
}

export function registerAgentConfigurationService(events: EventBus, configuration: SprintPlannerAgentConfiguration): () => void {
	return events.on(AGENT_ASSIGNMENT_REQUEST_CHANNEL, (data) => {
		const request = data as { version?: number; requestId?: unknown; agentId?: unknown };
		if (request?.version !== 1 || !validRequestId(request.requestId) || typeof request.agentId !== "string") return;
		const responseChannel = `${AGENT_ASSIGNMENT_RESPONSE_PREFIX}${request.requestId}`;
		if (!Object.prototype.hasOwnProperty.call(configuration, request.agentId)) {
			events.emit(responseChannel, {
				version: 1,
				requestId: request.requestId,
				agentId: request.agentId,
				error: `Unknown sprint-planner agent assignment: ${request.agentId}`,
			});
			return;
		}
		const agentId = request.agentId as SprintPlannerAgentId;
		events.emit(responseChannel, {
			version: 1,
			requestId: request.requestId,
			agentId,
			model: { ...configuration[agentId].model },
		});
	});
}
