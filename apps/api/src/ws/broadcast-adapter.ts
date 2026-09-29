// What a browser receives on a project socket. Nothing else may be put here:
// control messages between instances have their own type below.
export type ProjectBroadcastMessage = {
  type: string;
  projectId: string;
  taskId?: string;
  sourceTaskId?: string;
  targetTaskId?: string;
};

// Instance-to-instance instruction, never sent to a browser: close a user's
// sockets because their access ended. With an empty `projectId` on the
// envelope, every project socket of the user inside `workspaceId` is closed.
export type AccessRevokedControl = {
  kind: "access-revoked";
  userId: string;
  workspaceId?: string;
  /** The instance that issued it, which has already closed its own sockets. */
  origin?: string;
};

export type BroadcastMessage =
  | {
      projectId: string;
      message: ProjectBroadcastMessage;
      excludeInitiatorId?: string;
    }
  | {
      projectId: string;
      control: AccessRevokedControl;
    };

export type UserBroadcastMessage = {
  type: string;
  [key: string]: unknown;
};

export type UserBroadcast = {
  userId: string;
  message: UserBroadcastMessage;
  origin?: string;
};

export type BroadcastAdapter = {
  /** Publish a message to all instances watching this project */
  publish(msg: BroadcastMessage): Promise<void>;

  publishToUser(msg: UserBroadcast): Promise<void>;

  /** Subscribe to messages for delivery to local connections */
  subscribe(
    handler: (msg: BroadcastMessage) => void | Promise<void>,
  ): Promise<void>;

  subscribeToUser(handler: (msg: UserBroadcast) => void): Promise<void>;

  /** Cleanup on shutdown */
  shutdown(): Promise<void>;
};
