import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const MAX_QUESTIONS_PER_ROUND = 3;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 5;
export const OTHER_LABEL = "Other";

export interface JobQuestionOption {
	label: string;
	description?: string;
}

export interface JobQuestion {
	id: string;
	header: string;
	question: string;
	options: JobQuestionOption[];
}

export interface JobPlanInput {
	title: string;
	feature: string;
	requirements: string[];
	targets: Array<{ target: string; change: string }>;
	constraints: string[];
	assumptions: string[];
	decisions: string[];
	implementationSteps: string[];
	validationCriteria: string[];
	outOfScope: string[];
}

export interface PublishedJobPlan {
	id: string;
	directory: string;
	path: string;
	projectRoot: string;
}

function nonblank(value: unknown, path: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a nonblank string.`);
	return value.trim();
}

export function validateQuestions(value: unknown): JobQuestion[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > MAX_QUESTIONS_PER_ROUND) {
		throw new Error(`questions must contain between 1 and ${MAX_QUESTIONS_PER_ROUND} questions.`);
	}
	const ids = new Set<string>();
	return value.map((raw, questionIndex) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`questions[${questionIndex}] must be an object.`);
		const candidate = raw as Record<string, unknown>;
		const id = nonblank(candidate.id, `questions[${questionIndex}].id`);
		const idKey = id.toLocaleLowerCase();
		if (ids.has(idKey)) throw new Error(`Duplicate question id "${id}".`);
		ids.add(idKey);
		const header = nonblank(candidate.header, `questions[${questionIndex}].header`);
		if (header.length > 32) throw new Error(`questions[${questionIndex}].header must be at most 32 characters.`);
		const question = nonblank(candidate.question, `questions[${questionIndex}].question`);
		if (!Array.isArray(candidate.options) || candidate.options.length < MIN_OPTIONS || candidate.options.length > MAX_OPTIONS) {
			throw new Error(`questions[${questionIndex}].options must contain between ${MIN_OPTIONS} and ${MAX_OPTIONS} options.`);
		}
		const labels = new Set<string>();
		const options = candidate.options.map((rawOption, optionIndex) => {
			if (!rawOption || typeof rawOption !== "object" || Array.isArray(rawOption)) {
				throw new Error(`questions[${questionIndex}].options[${optionIndex}] must be an object.`);
			}
			const option = rawOption as Record<string, unknown>;
			const label = nonblank(option.label, `questions[${questionIndex}].options[${optionIndex}].label`);
			const labelKey = label.toLocaleLowerCase();
			if (labelKey === OTHER_LABEL.toLocaleLowerCase()) throw new Error(`The "${OTHER_LABEL}" option is added automatically.`);
			if (labels.has(labelKey)) throw new Error(`Duplicate option label "${label}" in question "${id}".`);
			labels.add(labelKey);
			const description = option.description === undefined
				? undefined
				: nonblank(option.description, `questions[${questionIndex}].options[${optionIndex}].description`);
			return description ? { label, description } : { label };
		});
		return { id, header, question, options };
	});
}

export function safeSlug(value: string, fallback = "job"): string {
	const slug = value
		.normalize("NFKD")
		.toLocaleLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 56)
		.replace(/-+$/g, "");
	return slug || fallback;
}

function bullets(values: readonly string[]): string {
	return values.length ? values.map((value) => `- ${value.trim()}`).join("\n") : "- None.";
}

export function renderJobPlan(plan: JobPlanInput, interview: { rounds: number; questions: number }): string {
	const targets = plan.targets.map(({ target, change }) => `- \`${target.trim()}\`: ${change.trim()}`).join("\n");
	const steps = plan.implementationSteps.map((step, index) => `${index + 1}. ${step.trim()}`).join("\n");
	return `# ${plan.title.trim()}\n\n` +
		`## Feature\n\n${plan.feature.trim()}\n\n` +
		`## Required Behavior\n\n${bullets(plan.requirements)}\n\n` +
		`## Targets\n\n${targets}\n\n` +
		`## Constraints\n\n${bullets(plan.constraints)}\n\n` +
		`## Assumptions\n\n${bullets(plan.assumptions)}\n\n` +
		`## Settled Decisions\n\n${bullets(plan.decisions)}\n\n` +
		`## Implementation Approach\n\n${steps}\n\n` +
		`## Validation Criteria\n\n${bullets(plan.validationCriteria)}\n\n` +
		`## Out of Scope\n\n${bullets(plan.outOfScope)}\n\n` +
		`## Planning Record\n\n- Interactive rounds completed: ${interview.rounds}\n- User questions answered: ${interview.questions}\n- Remaining consequential open questions: none\n`;
}

async function stat(path: string) {
	try {
		return await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

export async function locateInternalDev(cwd: string): Promise<{ projectRoot: string; internalDevPath: string; plansPath: string }> {
	let current = resolve(cwd);
	while (true) {
		const internalDevPath = resolve(current, ".internal-dev");
		const selected = await stat(internalDevPath);
		if (selected) {
			if (!selected.isDirectory() || selected.isSymbolicLink()) throw new Error("The nearest .internal-dev path is not a regular directory.");
			const plansPath = resolve(internalDevPath, "plans");
			const plans = await stat(plansPath);
			if (!plans?.isDirectory() || plans.isSymbolicLink()) throw new Error("The .internal-dev plans store is not ready. Run /internal-dev init.");
			return { projectRoot: current, internalDevPath, plansPath };
		}
		const parent = dirname(current);
		if (parent === current) throw new Error("No ready .internal-dev store was found. Run /internal-dev init before planning a job.");
		current = parent;
	}
}

export async function publishJobPlan(cwd: string, plan: JobPlanInput, interview: { rounds: number; questions: number }): Promise<PublishedJobPlan> {
	const location = await locateInternalDev(cwd);
	const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
	const base = `${stamp}-${safeSlug(plan.title)}`;
	for (let suffix = 1; suffix < 10_000; suffix++) {
		const id = `${base}${suffix === 1 ? "" : `-${suffix}`}`;
		const directory = resolve(location.plansPath, id);
		try {
			await mkdir(directory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
			throw error;
		}
		const path = resolve(directory, "plan.md");
		try {
			await writeFile(path, renderJobPlan(plan, interview), { encoding: "utf8", flag: "wx" });
			return { id, directory, path, projectRoot: location.projectRoot };
		} catch (error) {
			await rm(directory, { recursive: true, force: false }).catch(() => undefined);
			throw error;
		}
	}
	throw new Error("Could not allocate a unique job plan id.");
}
