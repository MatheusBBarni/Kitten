import type { AttemptGeneration, AttemptId, ProfileId } from "@kitten/engine";
import type { CertifiedDirectAcpProfile, AttemptStartupFailure } from "./contracts.ts";

export interface FreshDirectAcpSessionInput {
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly cwd: string;
  readonly model: string;
  readonly effort: string;
  readonly skillContent: string;
}

export interface DirectAcpConnection {
  newSession(input: FreshDirectAcpSessionInput): Promise<{ readonly sessionId: string }>;
  close(): void | Promise<void>;
}

export interface DirectAcpConnectionFactory {
  connect(input: {
    readonly profileId: ProfileId;
    readonly recipeId: string;
    readonly adapterVersion: string;
  }): Promise<DirectAcpConnection>;
}

export interface FreshDirectAcpSession {
  readonly sessionId: string;
  readonly connection: DirectAcpConnection;
}

export type FreshDirectAcpStartResult =
  | { readonly status: "started"; readonly session: FreshDirectAcpSession }
  | { readonly status: "failed"; readonly failure: Omit<AttemptStartupFailure, "occurredAt"> };

export interface DirectAcpAttemptStarter {
  start(input: FreshDirectAcpSessionInput & {
    readonly profile: CertifiedDirectAcpProfile;
  }): Promise<FreshDirectAcpStartResult>;
}

/** Fresh-only adapter: its public connection contract intentionally has no loadSession capability. */
export function createDirectAcpAttemptStarter(
  factory: DirectAcpConnectionFactory,
): DirectAcpAttemptStarter {
  return {
    async start(input) {
      if (!input.profile.readiness.ready) {
        return {
          status: "failed",
          failure: { code: "connection_failed", message: input.profile.readiness.message },
        };
      }
      let connection: DirectAcpConnection;
      try {
        connection = await factory.connect({
          profileId: input.profile.profileId,
          recipeId: input.profile.certification.recipeId,
          adapterVersion: input.profile.certification.adapterVersion,
        });
      } catch (error) {
        return {
          status: "failed",
          failure: { code: "connection_failed", message: legibleError(error, "Direct ACP handshake failed") },
        };
      }
      try {
        const session = await connection.newSession({
          attemptId: input.attemptId,
          generation: input.generation,
          cwd: input.cwd,
          model: input.model,
          effort: input.effort,
          skillContent: input.skillContent,
        });
        if (session.sessionId.trim().length === 0) throw new Error("Agent returned an empty session identity");
        return { status: "started", session: { sessionId: session.sessionId, connection } };
      } catch (error) {
        await safeClose(connection);
        return {
          status: "failed",
          failure: { code: "session_start_failed", message: legibleError(error, "Direct ACP session startup failed") },
        };
      }
    },
  };
}

export async function safeClose(connection: DirectAcpConnection): Promise<void> {
  try {
    await connection.close();
  } catch {
    // Closing a failed external session is best effort; durable attempt failure remains authoritative.
  }
}

function legibleError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}
