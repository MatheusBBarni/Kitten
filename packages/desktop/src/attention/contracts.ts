import type {
  AttemptGeneration,
  AttemptId,
  QuestionId,
  TerminalQuestionOutcome,
} from "@kitten/engine";
import type { BoardId, CardId } from "../workflow/workflowTypes.ts";

export const ATTENTION_FORM_LIMITS = {
  maxFields: 10,
  maxOptionsPerField: 20,
  maxTextBytes: 4 * 1024,
} as const;

export interface AttentionOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

interface AttentionFieldBase {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly required: boolean;
}

export type AttentionField =
  | (AttentionFieldBase & {
      readonly mode: "single" | "multi";
      readonly options: readonly AttentionOption[];
      readonly allowsCustom: boolean;
    })
  | (AttentionFieldBase & {
      readonly mode: "text";
    });

export interface AttentionForm {
  readonly title?: string;
  readonly context?: string;
  readonly prompt: string;
  readonly fields: readonly AttentionField[];
}

export interface AttentionAnswer {
  readonly selectedOptionIds: readonly string[];
  readonly customText?: string;
}

export type AttentionOutcome = TerminalQuestionOutcome<Readonly<Record<string, AttentionAnswer>>>;

export type NotificationState = "pending" | "delivered" | "failed";

export interface AttentionNotificationResult {
  readonly state: NotificationState;
  readonly attemptedAt: number | null;
  readonly failureCode: "unavailable" | null;
}

export interface AttentionBlockerProjection {
  readonly schemaVersion: 1;
  readonly blockerId: QuestionId;
  readonly callId: string;
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly form: AttentionForm;
  readonly active: boolean;
  readonly outcome: AttentionOutcome | null;
  readonly notification: AttentionNotificationResult;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly terminalAt: number | null;
}

export function validateAttentionForm(input: unknown): AttentionForm {
  const value = record(input, "attention form");
  exactKeys(value, ["prompt", "fields"], ["title", "context"]);
  const fieldsValue = value.fields;
  if (!Array.isArray(fieldsValue) || fieldsValue.length < 1 || fieldsValue.length > ATTENTION_FORM_LIMITS.maxFields) {
    throw new Error("attention form fields are invalid");
  }
  const fieldIds = new Set<string>();
  const fields = fieldsValue.map((entry) => {
    const field = validateField(entry);
    if (fieldIds.has(field.id)) throw new Error("attention form field IDs must be unique");
    fieldIds.add(field.id);
    return field;
  });
  return Object.freeze({
    ...(value.title === undefined ? {} : { title: boundedText(value.title, "attention title") }),
    ...(value.context === undefined ? {} : { context: boundedText(value.context, "attention context") }),
    prompt: boundedText(value.prompt, "attention prompt", true),
    fields: Object.freeze(fields),
  });
}

export function validateAttentionOutcome(input: unknown): AttentionOutcome {
  const value = record(input, "attention outcome");
  const kind = value.kind;
  if (kind === "skipped" || kind === "timed_out" || kind === "cancelled") {
    exactKeys(value, ["kind"]);
    return { kind };
  }
  if (kind !== "submitted") throw new Error("attention outcome is not terminal");
  exactKeys(value, ["kind", "answers"]);
  const answers = record(value.answers, "attention answers");
  const parsed: Record<string, AttentionAnswer> = {};
  for (const [fieldId, entry] of Object.entries(answers)) {
    const answer = record(entry, `attention answer ${fieldId}`);
    exactKeys(answer, ["selectedOptionIds"], ["customText"]);
    if (!Array.isArray(answer.selectedOptionIds)) throw new Error("attention selected options are invalid");
    const selectedOptionIds = answer.selectedOptionIds.map((optionId) => boundedText(optionId, "attention option ID", true));
    if (new Set(selectedOptionIds).size !== selectedOptionIds.length) {
      throw new Error("attention selected options must be unique");
    }
    parsed[fieldId] = Object.freeze({
      selectedOptionIds: Object.freeze(selectedOptionIds),
      ...(answer.customText === undefined
        ? {}
        : { customText: boundedText(answer.customText, "attention custom text") }),
    });
  }
  return { kind, answers: Object.freeze(parsed) };
}

export function validateAttentionBlockerProjection(input: unknown): AttentionBlockerProjection {
  const value = record(input, "attention blocker");
  exactKeys(value, [
    "schemaVersion", "blockerId", "callId", "boardId", "cardId", "attemptId", "generation",
    "form", "active", "outcome", "notification", "version", "createdAt", "updatedAt", "terminalAt",
  ]);
  if (value.schemaVersion !== 1 || typeof value.active !== "boolean") throw new Error("attention blocker schema is invalid");
  const notification = record(value.notification, "attention notification");
  exactKeys(notification, ["state", "attemptedAt", "failureCode"]);
  const state = notification.state as NotificationState;
  if (state !== "pending" && state !== "delivered" && state !== "failed") {
    throw new Error("attention notification state is invalid");
  }
  const outcome = value.outcome === null ? null : validateAttentionOutcome(value.outcome);
  const terminalAt = nullableInteger(value.terminalAt, "attention terminalAt");
  if (value.active !== (outcome === null) || (outcome === null) !== (terminalAt === null)) {
    throw new Error("attention blocker active and terminal evidence is inconsistent");
  }
  const attemptedAt = nullableInteger(notification.attemptedAt, "attention notification attemptedAt");
  const failureCode = notification.failureCode as "unavailable" | null;
  if (
    (state === "pending" && (attemptedAt !== null || failureCode !== null))
    || (state === "delivered" && (attemptedAt === null || failureCode !== null))
    || (state === "failed" && (attemptedAt === null || failureCode !== "unavailable"))
  ) {
    throw new Error("attention notification evidence is inconsistent");
  }
  const createdAt = integer(value.createdAt, "attention createdAt");
  const updatedAt = integer(value.updatedAt, "attention updatedAt");
  if (updatedAt < createdAt || (terminalAt !== null && terminalAt < createdAt)) {
    throw new Error("attention blocker timestamps are inconsistent");
  }
  return Object.freeze({
    schemaVersion: 1,
    blockerId: nonEmpty(value.blockerId, "attention blockerId") as QuestionId,
    callId: nonEmpty(value.callId, "attention callId"),
    boardId: nonEmpty(value.boardId, "attention boardId") as BoardId,
    cardId: nonEmpty(value.cardId, "attention cardId") as CardId,
    attemptId: nonEmpty(value.attemptId, "attention attemptId") as AttemptId,
    generation: integer(value.generation, "attention generation") as AttemptGeneration,
    form: validateAttentionForm(value.form),
    active: value.active,
    outcome,
    notification: Object.freeze({ state, attemptedAt, failureCode }),
    version: positiveInteger(value.version, "attention version"),
    createdAt,
    updatedAt,
    terminalAt,
  });
}

function validateField(input: unknown): AttentionField {
  const value = record(input, "attention field");
  const mode = value.mode;
  if (mode === "text") {
    exactKeys(value, ["id", "label", "required", "mode"], ["description"]);
    return Object.freeze({
      id: boundedText(value.id, "attention field ID", true),
      label: boundedText(value.label, "attention field label", true),
      ...(value.description === undefined ? {} : { description: boundedText(value.description, "attention field description") }),
      required: boolean(value.required, "attention field required"),
      mode,
    });
  }
  if (mode !== "single" && mode !== "multi") throw new Error("attention field mode is invalid");
  exactKeys(value, ["id", "label", "required", "mode", "options", "allowsCustom"], ["description"]);
  if (!Array.isArray(value.options) || value.options.length > ATTENTION_FORM_LIMITS.maxOptionsPerField) {
    throw new Error("attention field options are invalid");
  }
  const optionIds = new Set<string>();
  const options = value.options.map((entry) => {
    const option = record(entry, "attention option");
    exactKeys(option, ["id", "label"], ["description"]);
    const id = boundedText(option.id, "attention option ID", true);
    if (optionIds.has(id)) throw new Error("attention option IDs must be unique");
    optionIds.add(id);
    return Object.freeze({
      id,
      label: boundedText(option.label, "attention option label", true),
      ...(option.description === undefined ? {} : { description: boundedText(option.description, "attention option description") }),
    });
  });
  const allowsCustom = boolean(value.allowsCustom, "attention field allowsCustom");
  if (options.length === 0 && !allowsCustom) throw new Error("attention choice field has no answer path");
  return Object.freeze({
    id: boundedText(value.id, "attention field ID", true),
    label: boundedText(value.label, "attention field label", true),
    ...(value.description === undefined ? {} : { description: boundedText(value.description, "attention field description") }),
    required: boolean(value.required, "attention field required"),
    mode,
    options: Object.freeze(options),
    allowsCustom,
  });
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
    throw new Error(`${label} must be a plain object`);
  }
  return input as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("attention payload contains missing or unsupported fields");
  }
}

function boundedText(input: unknown, label: string, nonEmpty = false): string {
  if (
    typeof input !== "string"
    || (nonEmpty && input.length === 0)
    || Buffer.byteLength(input, "utf8") > ATTENTION_FORM_LIMITS.maxTextBytes
  ) throw new Error(`${label} is invalid`);
  return input;
}

function nonEmpty(input: unknown, label: string): string {
  return boundedText(input, label, true);
}

function boolean(input: unknown, label: string): boolean {
  if (typeof input !== "boolean") throw new Error(`${label} is invalid`);
  return input;
}

function integer(input: unknown, label: string): number {
  if (!Number.isSafeInteger(input) || (input as number) < 0) throw new Error(`${label} is invalid`);
  return input as number;
}

function positiveInteger(input: unknown, label: string): number {
  const value = integer(input, label);
  if (value === 0) throw new Error(`${label} must be positive`);
  return value;
}

function nullableInteger(input: unknown, label: string): number | null {
  return input === null ? null : integer(input, label);
}
