# Authentication

Required environment variables:

- MONGODB_CONNECTION_STRING
- ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET: distinct, randomly generated secrets.
- ACCESS_TOKEN_TTL (default: 15m)
- REFRESH_TOKEN_TTL (default: 14d)
- BUILD_MODE=production enables Secure cookies and requires HTTPS.

Use duration strings with units, such as 15m and 14d.

| Method | Endpoint | JSON body |
| --- | --- | --- |
| POST | /api/auth/register | fullName, email, password |
| POST | /api/auth/login | email, password |
| POST | /api/auth/refresh | None; uses refreshToken cookie |
| POST | /api/auth/logout | None; uses refreshToken cookie |

Registration returns 201 with data.userInfo; it does not automatically log in.
Passwords must contain at least 8 characters and occupy at most 72 UTF-8 bytes.
Registration always assigns role=user and status=active.
Login and refresh return data.userInfo and set accessToken/refreshToken HttpOnly cookies.
Tokens and password hashes are never included in the JSON response.

Cookies use SameSite=Lax and Path=/; deploy the frontend and API on the same
site. For local frontend development, use a development-server proxy to /api.
Cross-origin requests require an explicit credentials/CORS setup; cross-site
deployments additionally require a deliberate cookie and CSRF configuration.

Access JWT claims include sub (user ID), role, tokenType=access and a unique jti.
Refresh JWTs include sub, tokenType=refresh and a unique jti.
Both also carry iat and exp. Verification accepts HS256 only.
Future protected-route middleware must verify the access token with the access
secret and require tokenType=access; auth endpoints alone do not protect other routes.

The session model retains the refreshToken field name, but stores a SHA-256 hash.
Existing sessions from the old raw-token implementation require a new login.
Each login creates a separate session. Refresh atomically replaces its token hash
and extends the session expiration. The client should serialize refresh requests.
Expired database sessions are rejected even if MongoDB TTL cleanup has not run.

Logout deletes only the matching session and clears both cookies. Repeated logout
and logout without a cookie succeed. If session deletion fails, the API reports an
error instead of claiming that the session was revoked.
A copied access token remains valid until its expiry (15 minutes by default);
immediate access-token revocation would require a session check or denylist.

Run npm test in backend. Tests use real bcrypt/JWT and HTTP requests with mocked
database methods; they do not validate connectivity or indexes in a live MongoDB.
