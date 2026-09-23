export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, "not_found", 404);
  }
}

export class ForbiddenError extends AppError {
  constructor(msg = "Insufficient permissions") {
    super(msg, "forbidden", 403);
  }
}

export class ConflictError extends AppError {
  constructor(msg: string) {
    super(msg, "conflict", 409);
  }
}

export class GoneError extends AppError {
  constructor(msg: string) {
    super(msg, "gone", 410);
  }
}
