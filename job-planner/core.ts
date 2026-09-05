import { lstat, mkdir, open, readFile, rmdir, unlink } from "node:fs/promises";
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

export interface JobPlanValidationRecord {
	verdict: "PASS";
	provider: string;
	model: string;
	thinking: string;
	attempts: number;
	repairs: number;
	validatedAt: string;
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

function stringArray(value: unknown, path: string, minimum: number): string[] {
	if (!Array.isArray(value) || value.length < minimum) throw new Error(`${path} must contain at least ${minimum} item(s).`);
	return value.map((item, index) => nonblank(item, `${path}[${index}]`));
}

export function validateJobPlan(value: unknown): JobPlanInput {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Job plan must be an object.");
	const candidate = value as Record<string, unknown>;
	const title = nonblank(candidate.title, "title");
	if (title.length > 160) throw new Error("title must be at most 160 characters.");
	if (!Array.isArray(candidate.targets) || candidate.targets.length < 1) throw new Error("targets must contain at least one item.");
	const targets = candidate.targets.map((raw, index) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`targets[${index}] must be an object.`);
		const target = raw as Record<string, unknown>;
		return { target: nonblank(target.target, `targets[${index}].target`), change: nonblank(target.change, `targets[${index}].change`) };
	});
	return {
		title,
		feature: nonblank(candidate.feature, "feature"),
		requirements: stringArray(candidate.requirements, "requirements", 1),
		targets,
		constraints: stringArray(candidate.constraints, "constraints", 1),
		assumptions: stringArray(candidate.assumptions, "assumptions", 0),
		decisions: stringArray(candidate.decisions, "decisions", 0),
		implementationSteps: stringArray(candidate.implementationSteps, "implementationSteps", 1),
		validationCriteria: stringArray(candidate.validationCriteria, "validationCriteria", 1),
		outOfScope: stringArray(candidate.outOfScope, "outOfScope", 0),
	};
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

export function validateJobPlanValidationRecord(value: unknown): JobPlanValidationRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A complete red-team validation record is required.");
	const candidate = value as Record<string, unknown>;
	if (candidate.verdict !== "PASS") throw new Error("Red-team validation verdict must be PASS.");
	const attempts = candidate.attempts;
	const repairs = candidate.repairs;
	if (!Number.isSafeInteger(attempts) || (attempts as number) < 1) throw new Error("Red-team validation attempts must be a positive integer.");
	if (!Number.isSafeInteger(repairs) || (repairs as number) < 0) throw new Error("Red-team repair count must be a nonnegative integer.");
	const validatedAt = nonblank(candidate.validatedAt, "validation.validatedAt");
	if (!Number.isFinite(Date.parse(validatedAt))) throw new Error("validation.validatedAt must be an ISO-compatible timestamp.");
	return {
		verdict: "PASS",
		provider: nonblank(candidate.provider, "validation.provider"),
		model: nonblank(candidate.model, "validation.model"),
		thinking: nonblank(candidate.thinking, "validation.thinking"),
		attempts: attempts as number,
		repairs: repairs as number,
		validatedAt,
	};
}

export function renderJobPlan(plan: JobPlanInput, interview: { rounds: number; questions: number }, validation: JobPlanValidationRecord): string {
	const normalized = validateJobPlan(plan);
	const validated = validateJobPlanValidationRecord(validation);
	const targets = normalized.targets.map(({ target, change }) => `- \`${target}\`: ${change}`).join("\n");
	const steps = normalized.implementationSteps.map((step, index) => `${index + 1}. ${step}`).join("\n");
	return `# ${normalized.title}\n\n` +
		`## Feature\n\n${normalized.feature}\n\n` +
		`## Required Behavior\n\n${bullets(normalized.requirements)}\n\n` +
		`## Targets\n\n${targets}\n\n` +
		`## Constraints\n\n${bullets(normalized.constraints)}\n\n` +
		`## Assumptions\n\n${bullets(normalized.assumptions)}\n\n` +
		`## Settled Decisions\n\n${bullets(normalized.decisions)}\n\n` +
		`## Implementation Approach\n\n${steps}\n\n` +
		`## Validation Criteria\n\n${bullets(normalized.validationCriteria)}\n\n` +
		`## Out of Scope\n\n${bullets(normalized.outOfScope)}\n\n` +
		`## Planning Record\n\n- Interactive rounds completed: ${interview.rounds}\n- User questions answered: ${interview.questions}\n- Red-team validation: ${validated.verdict}\n- Red-team validator: ${validated.provider}/${validated.model}:${validated.thinking}\n- Red-team validation attempts: ${validated.attempts}\n- Inferable issues corrected: ${validated.repairs}\n- Validated at: ${validated.validatedAt}\n- Remaining consequential open questions: none\n`;
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

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error("Job-plan publication was cancelled.");
}

interface FileIdentity {
	dev: number | bigint;
	ino: number | bigint;
}

const sameIdentity = (left: FileIdentity, right: FileIdentity): boolean => left.dev === right.dev && left.ino === right.ino;

async function cleanupOwnedReservation(directory: string, directoryIdentity: FileIdentity, ownedFile?: { path: string; identity: FileIdentity; content: string }): Promise<void> {
	const currentDirectory = await stat(directory);
	if (!currentDirectory || !sameIdentity(currentDirectory, directoryIdentity)) return;
	if (ownedFile) {
		const beforeRead = await stat(ownedFile.path);
		if (!beforeRead || beforeRead.isSymbolicLink() || !beforeRead.isFile() || !sameIdentity(beforeRead, ownedFile.identity)) return;
		const content = await readFile(ownedFile.path, "utf8").catch(() => undefined);
		const afterRead = await stat(ownedFile.path);
		if (content !== ownedFile.content || !afterRead || !sameIdentity(afterRead, ownedFile.identity)) return;
		await unlink(ownedFile.path).catch(() => undefined);
	}
	const beforeRemove = await stat(directory);
	if (!beforeRemove || !sameIdentity(beforeRemove, directoryIdentity)) return;
	await rmdir(directory).catch(() => undefined);
}

export async function publishJobPlan(cwd: string, plan: JobPlanInput, interview: { rounds: number; questions: number }, validation: JobPlanValidationRecord, signal?: AbortSignal): Promise<PublishedJobPlan> {
	const normalized = validateJobPlan(plan);
	validateJobPlanValidationRecord(validation);
	throwIfAborted(signal);
	const location = await locateInternalDev(cwd);
	throwIfAborted(signal);
	const content = renderJobPlan(normalized, interview, validation);
	const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
	const base = `${stamp}-${safeSlug(normalized.title)}`;
	for (let suffix = 1; suffix < 10_000; suffix++) {
		const id = `${base}${suffix === 1 ? "" : `-${suffix}`}`;
		const directory = resolve(location.plansPath, id);
		try {
			throwIfAborted(signal);
			await mkdir(directory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
			throw error;
		}
		const directoryStat = await lstat(directory);
		const directoryIdentity = { dev: directoryStat.dev, ino: directoryStat.ino };
		const path = resolve(directory, "plan.md");
		let ownedFile: { path: string; identity: FileIdentity; content: string } | undefined;
		try {
			throwIfAborted(signal);
			const handle = await open(path, "wx");
			try {
				const opened = await handle.stat();
				ownedFile = { path, identity: { dev: opened.dev, ino: opened.ino }, content };
				await handle.writeFile(content, { encoding: "utf8" });
			} finally {
				await handle.close();
			}
			if (signal?.aborted) {
				await cleanupOwnedReservation(directory, directoryIdentity, ownedFile);
				throwIfAborted(signal);
			}
			return { id, directory, path, projectRoot: location.projectRoot };
		} catch (error) {
			await cleanupOwnedReservation(directory, directoryIdentity, ownedFile).catch(() => undefined);
			throw error;
		}
	}
	throw new Error("Could not allocate a unique job plan id.");
}
