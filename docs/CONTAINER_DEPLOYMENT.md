# Container deployment

This package runs the testnet services in separate containers. It does not establish public hosting. Use an approved host before publishing the service. Keep the existing live worker stopped during a move of its database and wallet session. Two independent database copies must not control the same live wallet.

## Service boundaries

| Service | Mounted private files | Stored files | Published ports |
| --- | --- | --- | --- |
| Gateway | None | TLS certificates and public web files | HTTP and HTTPS only |
| API | API identity and API environment | Evidence: read and write | None |
| Verifier | Evidence key, researcher report key, admission key, verdict key, verifier environment | Evidence: read only. Reports: read and write | None |
| Report service | Report environment and organization report keys | Reports: read only. Organization keys: read and write | None |
| Worker | Worker identity, Privy authorization key, worker environment, Circle session | Circle session: read and write | None |
| Retention | Database environment | Evidence and reports: read and delete | None |
| PostgreSQL | Database password | Database volume | None |

Each service receives its own environment file through a secret mount. The image does not include `.env`, `.local`, stored reports, wallet sessions, or public evidence files. The service and web images use pinned base image digests. The dependency lock file fixes the package versions. The public Privy app ID is a web build argument. Never use a secret as a build argument.

The application containers run as an unprivileged user. They have a read-only root filesystem and no Linux capabilities. Only their listed data mounts and bounded temporary directories accept writes. The database has a private network. The gateway has no database network connection. Containers still share the configured application database role. Separate database roles and a host security review remain required for production readiness.

The gateway forwards the public API and the two authenticated report download paths. It rejects internal service routes. Service-to-service requests also require signed service tokens. A gateway routing rule does not replace service authentication.

This design uses [Docker Compose secret mounts](https://docs.docker.com/compose/how-tos/use-secrets/) and [explicit Compose networks](https://docs.docker.com/reference/compose-file/networks/). Compose secrets use host files. Protect those files and the Docker administration account. Compose does not provide encrypted host storage.

## Local container check

This check uses a new database, empty ciphertext directories, and a separate Compose project. It copies the existing testnet verifier keys into an ignored check directory. It excludes Circle sessions, Privy signing credentials, and model keys. The worker starts only its configured Graph jobs. This check cannot prove financial execution or the complete release journey.

1. Run `pnpm containers:prepare` from the repository root.
2. Run `docker compose --project-name vulnproof-container-check --env-file .local/container-check/compose.env -f infra/deployment.compose.yaml build api gateway`.
3. Run `docker compose --project-name vulnproof-container-check --env-file .local/container-check/compose.env -f infra/deployment.compose.yaml up -d --wait postgres`.
4. Run `docker compose --project-name vulnproof-container-check --env-file .local/container-check/compose.env -f infra/deployment.compose.yaml run --rm migrate`.
5. Run `docker compose --project-name vulnproof-container-check --env-file .local/container-check/compose.env -f infra/deployment.compose.yaml up -d --wait`.
6. Run `pnpm containers:check`.
7. Run `docker compose --project-name vulnproof-container-check --env-file .local/container-check/compose.env -f infra/deployment.compose.yaml stop` when the check is complete.

The check validates HTTPS with the local root certificate. It does not disable certificate verification or install a root certificate into the user's trust store. A browser can show an untrusted certificate for this local site. Do not treat that browser state as a public HTTPS deployment.

The check writes `evidence/local/container-check.json`. It checks service health where health probes exist, container permissions, rejected unauthenticated reads, blocked internal paths, and actual file access. It also confirms that all database migrations ran in a separate release step. Worker health confirms startup and process availability. It does not prove that every provider job succeeds. Retention remains a long-running process whose scan results need monitoring.

## Host configuration

Create separate `DEPLOY_SECRETS` and `DEPLOY_DATA` directories outside the source checkout. Set `SERVICE_UID` and `SERVICE_GID` to the unprivileged host account that owns these files. Give secret files mode `0600` and private directories mode `0700`. Preserve existing keys during a move. New keys cannot decrypt old reports or satisfy existing signed bounty policies.

Create the data subdirectories `evidence`, `reports`, `report-keys`, `circle`, `caddy-data`, and `caddy-config`. Mount only encrypted report and evidence files in the corresponding data directories. The Circle session belongs only in `circle`. Complete Circle testnet authentication in the worker environment. A macOS Keychain session does not automatically move into a Linux container. Do not export unrelated credentials.

Create the secret files named in `infra/deployment.compose.yaml`. Use these environment values:

| File | Required configuration |
| --- | --- |
| `database-password` | Random database password, as plain file bytes |
| `database.env` | `DATABASE_URL` for the private `postgres:5432` service |
| `api.env` | Database URL, Privy app ID and app secret, escrow address, Circle agent address, public web origin, and model ID when enabled |
| `verifier.env` | Database URL, Privy app ID, escrow address |
| `reports.env` | Database URL and Privy app ID |
| `worker.env` | Database URL, Graph endpoint and deployment ID, optional Graph query key, Privy app ID and secret, escrow address, Circle agent address, model key and model ID when enabled |

`APP_ENV` is fixed to `arc-testnet`. The container entry rejects local test identities. The Compose file sets internal URLs and mounted key paths. Do not point these URLs at public services. The API currently enables the assistant from a model key presence check. Hosted model configuration needs a separate availability setting before the API can omit that key.

Set `SITE_ADDRESS` to the approved public domain. Set `WEB_ORIGIN` in `api.env` to its exact HTTPS origin. Register that origin in Privy before the browser check. Set `BIND_ADDRESS=0.0.0.0`, `HTTP_PORT=80`, and `HTTPS_PORT=443` on the approved host. Point the domain to the host. Open only the gateway ports. Persist the Caddy data directory so certificate renewal can continue.

[Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https) uses a local certificate authority for localhost. It uses public certificate services for eligible public domains. Public certificate validation requires correct DNS and reachable gateway ports.

Run migrations as the separate `migrate` service before starting application services. Use an immutable release tag and record the built image digests. Do not run database migrations on every application restart. Keep database, ciphertext, and key backups consistent. Follow [retention and recovery](RETENTION_AND_RECOVERY.md) before bringing a restored stack online.

Public hosting, Linux Circle authentication, complete provider configuration, financial restore, and the full staging acceptance scenario remain release requirements.
