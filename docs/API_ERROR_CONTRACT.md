# API error and request ID contract

Newly standardized endpoints return errors as:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "requestId": "123e4567-e89b-42d3-a456-426614174000"
  }
}
```

Every response has an `x-request-id` header. A client UUID in that header is preserved; absent, malformed, or unsafe values are replaced with a generated UUID. Include this ID when reporting an API problem.

The global error handler logs only request ID, method, sanitized path, HTTP status and stable error code. It does not log authorization headers, request bodies, tokens, keys, health details or binary uploads. Unknown and provider errors use generic public messages.

The standardized validation/error contract currently applies to `PATCH /api/profile`, `POST /api/telegram/link-token`, and `POST /api/membership/renew`. Other legacy routes retain their existing error payloads until migrated deliberately; successful response payloads are unchanged.
