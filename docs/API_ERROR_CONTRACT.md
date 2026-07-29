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

All API error responses are normalized at the HTTP boundary, including legacy route handlers. Successful response payloads are unchanged.

Stable error codes are: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `QUOTA_EXCEEDED` (429), `EXTERNAL_PROVIDER_ERROR` (502), `INTERNAL_CONFIGURATION_ERROR` (500), and `INTERNAL_ERROR` (500). Missing server configuration is never exposed to clients and uses the public message `Service is temporarily unavailable`.
