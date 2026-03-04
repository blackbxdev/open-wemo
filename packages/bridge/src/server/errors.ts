/**
 * API Error Types
 *
 * Consistent error handling for the REST API.
 */

/**
 * Error codes used in API responses.
 */
export const ErrorCodes = {
  // General errors
  NOT_FOUND: "NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_BODY: "INVALID_BODY",

  // Device errors
  DEVICE_NOT_FOUND: "DEVICE_NOT_FOUND",
  DEVICE_OFFLINE: "DEVICE_OFFLINE",
  DEVICE_OPERATION_FAILED: "DEVICE_OPERATION_FAILED",
  INSIGHT_NOT_SUPPORTED: "INSIGHT_NOT_SUPPORTED",

  // Discovery errors
  DISCOVERY_TIMEOUT: "DISCOVERY_TIMEOUT",
  DISCOVERY_FAILED: "DISCOVERY_FAILED",

  // Rules errors
  RULES_NOT_SUPPORTED: "RULES_NOT_SUPPORTED",
  RULES_FETCH_FAILED: "RULES_FETCH_FAILED",
  RULES_STORE_FAILED: "RULES_STORE_FAILED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Base API error with consistent structure.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode;
  public readonly deviceId?: string;

  constructor(message: string, status: number, code: ErrorCode, deviceId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.deviceId = deviceId;
  }

  /**
   * Converts the error to a JSON-serializable object.
   */
  toJSON() {
    return {
      error: true,
      code: this.code,
      message: this.message,
      ...(this.deviceId && { deviceId: this.deviceId }),
    };
  }
}

/**
 * Error thrown when a device is not found in the database.
 */
export class DeviceNotFoundError extends ApiError {
  constructor(deviceId: string) {
    super(`Device not found: ${deviceId}`, 404, ErrorCodes.DEVICE_NOT_FOUND, deviceId);
    this.name = "DeviceNotFoundError";
  }
}

/**
 * Error thrown when a device is offline or unreachable.
 */
export class DeviceOfflineError extends ApiError {
  constructor(deviceId: string, reason?: string) {
    const message = reason ? `Device offline: ${reason}` : "Device offline or unreachable";
    super(message, 503, ErrorCodes.DEVICE_OFFLINE, deviceId);
    this.name = "DeviceOfflineError";
  }
}

/**
 * Error thrown when a device operation fails.
 */
export class DeviceOperationError extends ApiError {
  public readonly operation: string;

  constructor(deviceId: string, operation: string, reason?: string) {
    const message = reason
      ? `Failed to ${operation}: ${reason}`
      : `Device operation failed: ${operation}`;
    super(message, 500, ErrorCodes.DEVICE_OPERATION_FAILED, deviceId);
    this.name = "DeviceOperationError";
    this.operation = operation;
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      operation: this.operation,
    };
  }
}

/**
 * Error thrown when Insight features are requested on a non-Insight device.
 */
export class InsightNotSupportedError extends ApiError {
  constructor(deviceId: string) {
    super(
      "Device does not support Insight power monitoring",
      400,
      ErrorCodes.INSIGHT_NOT_SUPPORTED,
      deviceId
    );
    this.name = "InsightNotSupportedError";
  }
}

/**
 * Error thrown for validation failures.
 */
export class ValidationError extends ApiError {
  public readonly fields?: string[];

  constructor(message: string, fields?: string[]) {
    super(message, 400, ErrorCodes.VALIDATION_ERROR);
    this.name = "ValidationError";
    this.fields = fields;
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      ...(this.fields && { fields: this.fields }),
    };
  }
}

/**
 * Error thrown when rules/timer features are requested on an unsupported device.
 */
export class RulesNotSupportedError extends ApiError {
  constructor(deviceId: string) {
    super(
      "Device does not support timer/schedule rules",
      400,
      ErrorCodes.RULES_NOT_SUPPORTED,
      deviceId
    );
    this.name = "RulesNotSupportedError";
  }
}

/**
 * Error thrown when fetching rules from device fails.
 */
export class RulesFetchError extends ApiError {
  constructor(deviceId: string, reason?: string) {
    const message = reason
      ? `Failed to fetch rules: ${reason}`
      : "Failed to fetch rules from device";
    super(message, 502, ErrorCodes.RULES_FETCH_FAILED, deviceId);
    this.name = "RulesFetchError";
  }
}

/**
 * Error thrown when storing rules to device fails.
 */
export class RulesStoreError extends ApiError {
  constructor(deviceId: string, reason?: string) {
    const message = reason ? `Failed to store rules: ${reason}` : "Failed to store rules to device";
    super(message, 502, ErrorCodes.RULES_STORE_FAILED, deviceId);
    this.name = "RulesStoreError";
  }
}

/**
 * Checks if an error is an ApiError.
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Converts any error to an ApiError for consistent handling.
 */
export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new ApiError(error.message, 500, ErrorCodes.INTERNAL_ERROR);
  }

  return new ApiError("An unexpected error occurred", 500, ErrorCodes.INTERNAL_ERROR);
}
