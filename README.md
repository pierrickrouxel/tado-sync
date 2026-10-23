# tado-sync

Automatically syncs the gas meter indexes read by **GRDF** (Gazpar) to **Tado Energy IQ** meter
readings, through a scheduled job running in a Docker container.

## How it works

On every run (by default every day at 10:00, Paris time):

1. log in to the [monespace.grdf.fr](https://monespace.grdf.fr) customer portal and fetch the
   informative daily readings of the last `LOOKBACK_DAYS` days;
2. read the readings already stored in Tado Energy IQ;
3. push to Tado every GRDF index (in m³, rounded to an integer) newer than the latest reading
   Tado knows. Running a sync again therefore never sends duplicates.

GRDF usually publishes the previous day's data during the morning, hence the default schedule.

## Quick start

```bash
cp .env.example .env   # then fill in your GRDF credentials
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d
docker compose logs -f
```

On first start there is no Tado token yet: a `https://login.tado.com/...` link is printed in the
logs. Open it and grant access with your Tado account (the link expires after a few minutes, a new
one is then generated). The refresh token is then kept in `/data/tado-token.json`, so this volume
must be persistent.

To run a single sync:

```bash
docker run --rm --env-file .env -v ./data:/data ghcr.io/pierrickrouxel/tado-sync --once
```

The `--auth` flag only performs the Tado authorization, then exits.

## Configuration

| Variable             | Required | Default                 | Description                                                |
| -------------------- | -------- | ----------------------- | ---------------------------------------------------------- |
| `GRDF_USERNAME`      | yes      |                         | GRDF customer portal e-mail                                |
| `GRDF_PASSWORD`      | yes      |                         | GRDF password (two-factor authentication must be disabled) |
| `GRDF_PCE`           | no       | account's first PCE     | Metering point number                                      |
| `TADO_HOME_ID`       | no       | account's first home    | Tado home id                                               |
| `TADO_REFRESH_TOKEN` | no       |                         | Initial Tado refresh token, if you already have one        |
| `TADO_TOKEN_FILE`    | no       | `/data/tado-token.json` | File storing the Tado refresh token                        |
| `CRON`               | no       | `0 10 * * *`            | Schedule, in cron format                                   |
| `TZ`                 | no       | `Europe/Paris`          | Time zone of the schedule                                  |
| `LOOKBACK_DAYS`      | no       | `30`                    | Number of days of GRDF history fetched                     |
| `RUN_ON_START`       | no       | `true`                  | Run a sync on startup                                      |
| `DRY_RUN`            | no       | `false`                 | Log the readings without sending them to Tado              |
| `LOG_LEVEL`          | no       | `info`                  | `debug`, `info`, `warn` or `error`                         |

## APIs used

- **GRDF**: the API behind the personal customer portal (`monespace.grdf.fr/api/e-conso`), the same
  one used by [PyGazpar](https://github.com/ssenart/PyGazpar). GRDF's official ADICT API is
  reserved for partner companies.
- **Tado**: OAuth2 *device code flow* authentication (`login.tado.com`) and the Energy IQ API
  (`energy-insights.tado.com/api/homes/{id}/meterReadings`).

These APIs are not publicly documented and may change without notice.

## Development

```bash
npm ci
npm test
npm run build
GRDF_USERNAME=... GRDF_PASSWORD=... DRY_RUN=true npm run sync
```

## Versioning and publishing

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/).
On every push to `main`, GitHub Actions runs the tests, then
[semantic-release](https://semantic-release.gitbook.io/) computes the version and creates the tag
and the GitHub release, and the multi-architecture Docker image (`amd64`, `arm64`) is published to
`ghcr.io/pierrickrouxel/tado-sync` with the `X.Y.Z`, `X.Y`, `X` and `latest` tags.
