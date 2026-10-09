export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 409,
    public details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
export function requireValue<T>(
  value: T | null | undefined,
  code = 'NOT_FOUND',
  message = '요청한 데이터를 찾을 수 없습니다.',
): T {
  if (value == null) throw new DomainError(code, message, 404);
  return value;
}
