// Stable, machine-readable error codes used throughout the planner.
export const ErrorCode = Object.freeze({
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  INVALID_FRUSTUM: "INVALID_FRUSTUM",
  DEPTH_TOO_LOW: "DEPTH_TOO_LOW",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
});

export class TerrainPlanError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TerrainPlanError";
    this.code = code;
    this.details = details;
  }
}
